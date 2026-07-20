import prisma from '../utils/prisma';
import { VerifiedProviderPayment } from './paymentProviderService';
import { enqueueUserNotification } from './notificationEventService';
import { scheduleNotificationOutbox } from './notificationOutboxService';

type ProviderName = 'FLUTTERWAVE' | 'STRIPE';

type ProviderEvent = {
  id: string;
  type: string;
  payloadHash: string;
};

const successStatuses = new Set(['SUCCESS', 'SUCCESSFUL', 'SUCCEEDED', 'PAID']);

const mismatchReason = (payment: any, verified: VerifiedProviderPayment, provider: ProviderName) => {
  if (payment.provider !== provider) return 'PROVIDER_MISMATCH';
  if (payment.reference !== verified.reference) return 'REFERENCE_MISMATCH';
  if (!Number.isSafeInteger(verified.amount) || payment.amount !== verified.amount) return 'AMOUNT_MISMATCH';
  if (payment.currency !== verified.currency) return 'CURRENCY_MISMATCH';
  if (!successStatuses.has(verified.status)) return 'PAYMENT_NOT_SUCCESSFUL';
  if (payment.providerSessionId && verified.providerSessionId && payment.providerSessionId !== verified.providerSessionId) {
    return 'SESSION_MISMATCH';
  }
  if (payment.providerPaymentId && verified.providerPaymentId && payment.providerPaymentId !== verified.providerPaymentId) {
    return 'PROVIDER_PAYMENT_MISMATCH';
  }
  return null;
};

const createEvent = (tx: any, provider: ProviderName, event: ProviderEvent, reference?: string) => tx.paymentEvent.create({
  data: {
    provider,
    providerEventId: event.id.slice(0, 200),
    eventType: event.type.slice(0, 120),
    paymentReference: reference || null,
    payloadHash: event.payloadHash,
  },
});

export const reconcileSuccessfulPayment = async (
  provider: ProviderName,
  verified: VerifiedProviderPayment,
  event: ProviderEvent,
) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await createEvent(tx, provider, event, verified.reference);
      const payment = await tx.externalPayment.findUnique({ where: { reference: verified.reference } });
      if (!payment) return { outcome: 'UNKNOWN_PAYMENT' };
      if (payment.status === 'SUCCEEDED' && payment.creditedAt) return { outcome: 'ALREADY_CREDITED' };

      const mismatch = mismatchReason(payment, verified, provider);
      if (mismatch) {
        await tx.externalPayment.update({
          where: { id: payment.id },
          data: {
            status: 'REVIEW_REQUIRED',
            providerStatus: verified.status,
            failureReason: mismatch,
            providerSessionId: verified.providerSessionId || payment.providerSessionId,
            providerPaymentId: verified.providerPaymentId || payment.providerPaymentId,
          },
        });
        return { outcome: 'REVIEW_REQUIRED', reason: mismatch };
      }

      const claimed = await tx.externalPayment.updateMany({
        where: { id: payment.id, status: { in: ['CREATING', 'PENDING', 'FAILED'] } },
        data: { status: 'CREDITING', providerStatus: verified.status },
      });
      if (claimed.count !== 1) return { outcome: 'ALREADY_PROCESSING' };

      const user = await tx.user.findUnique({ where: { id: payment.userId }, select: { accountIds: true } });
      if (!user) throw new Error('Payment user not found during settlement.');
      const account = await tx.account.findFirst({
        where: { id: { in: user.accountIds || [] }, type: payment.targetAccountType },
      });
      if (!account || account.currency !== payment.currency) throw new Error('Payment target account not found or currency mismatch.');

      await tx.account.update({
        where: { id: account.id },
        data: {
          currentBalance: { increment: payment.amount },
          availableBalance: { increment: payment.amount },
        },
      });
      const transaction = await tx.transaction.create({
        data: {
          userId: payment.userId,
          purpose: `Approvisionnement ${payment.targetAccountType}`,
          amount: payment.amount,
          status: 'SUCCESS',
          transactionRef: `PAYMENT_${payment.reference}`,
          targetAccountType: payment.targetAccountType,
          currency: payment.currency,
          createdBy: provider,
          operation: {
            type: 'external_account_funding',
            provider,
            externalPaymentId: payment.id,
            providerPaymentId: verified.providerPaymentId,
          },
        },
      });

      const journalReference = `FUNDING_${payment.reference}`;
      await tx.ledgerEntry.create({
        data: {
          journalReference,
          paymentId: payment.id,
          accountCode: `PROVIDER_CLEARING:${provider}`,
          direction: 'DEBIT',
          amount: payment.amount,
          currency: payment.currency,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          journalReference,
          paymentId: payment.id,
          accountCode: `USER_ACCOUNT:${account.id}`,
          direction: 'CREDIT',
          amount: payment.amount,
          currency: payment.currency,
        },
      });

      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: {
          code: 'NFS_GLOBAL',
          ...(payment.targetAccountType === 'EPARGNE'
            ? { totalSavings: payment.amount }
            : { totalPrincipal: payment.amount }),
          availableLiquidity: payment.amount,
        },
        update: {
          ...(payment.targetAccountType === 'EPARGNE'
            ? { totalSavings: { increment: payment.amount } }
            : { totalPrincipal: { increment: payment.amount } }),
          availableLiquidity: { increment: payment.amount },
          lastUpdated: new Date(),
        },
      });

      await tx.externalPayment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerStatus: verified.status,
          providerSessionId: verified.providerSessionId || payment.providerSessionId,
          providerPaymentId: verified.providerPaymentId || payment.providerPaymentId,
          creditedTransactionId: transaction.id,
          creditedAt: new Date(),
          failureReason: null,
        },
      });
      await enqueueUserNotification(tx, {
        eventKey: `financial:funding:${payment.reference}:${payment.userId}`,
        type: 'ACCOUNT_FUNDING_COMPLETED',
        aggregateType: 'ExternalPayment',
        aggregateId: payment.id,
        userId: payment.userId,
        title: 'Approvisionnement confirme',
        body: `${payment.amount.toLocaleString('fr-FR')} ${payment.currency} ont ete credites sur votre compte ${payment.targetAccountType}.`,
        mandatoryEmail: true,
        data: { url: '/history', transactionId: transaction.id, paymentId: payment.id },
        receipt: {
          transactionId: transaction.id,
          type: 'APPROVISIONNEMENT',
          title: 'Recu d approvisionnement',
          amount: payment.amount,
          currency: payment.currency,
          direction: 'CREDIT',
          reference: payment.reference,
          occurredAt: (transaction.createdAt || new Date()).toISOString(),
          paymentMethod: `${provider} - ${payment.method}`,
          purpose: `Approvisionnement ${payment.targetAccountType}`,
          destination: payment.targetAccountType,
          fees: 0,
          total: payment.amount,
          status: 'CONFIRMEE',
          providerReference: verified.providerPaymentId,
        },
      });
      return { outcome: 'CREDITED', transactionId: transaction.id };
    });
    if (result.outcome === 'CREDITED') scheduleNotificationOutbox();
    return result;
  } catch (error: any) {
    if (error?.code === 'P2002') return { outcome: 'DUPLICATE_EVENT' };
    throw error;
  }
};

export const recordNonSuccessfulPaymentEvent = async (
  provider: ProviderName,
  reference: string | undefined,
  providerStatus: string,
  event: ProviderEvent,
) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await createEvent(tx, provider, event, reference);
      if (!reference) return { outcome: 'EVENT_RECORDED' };
      const payment = await tx.externalPayment.findUnique({ where: { reference } });
      if (!payment || payment.status === 'SUCCEEDED') return { outcome: 'EVENT_RECORDED' };
      await tx.externalPayment.update({
        where: { id: payment.id },
        data: {
          status: ['FAILED', 'CANCELLED', 'EXPIRED'].includes(providerStatus) ? 'FAILED' : payment.status,
          providerStatus: providerStatus.slice(0, 80),
        },
      });
      return { outcome: 'PAYMENT_UPDATED' };
    });
  } catch (error: any) {
    if (error?.code === 'P2002') return { outcome: 'DUPLICATE_EVENT' };
    throw error;
  }
};

export const recordPaymentRiskEvent = async (
  provider: ProviderName,
  lookup: { reference?: string; providerPaymentId?: string },
  reason: string,
  event: ProviderEvent,
) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await createEvent(tx, provider, event, lookup.reference);
      const payment = await tx.externalPayment.findFirst({
        where: {
          provider,
          OR: [
            ...(lookup.reference ? [{ reference: lookup.reference }] : []),
            ...(lookup.providerPaymentId ? [{ providerPaymentId: lookup.providerPaymentId }] : []),
          ],
        },
      });
      if (!payment) return { outcome: 'UNKNOWN_PAYMENT' };
      if (payment.status === 'REVIEW_REQUIRED') return { outcome: 'ALREADY_FLAGGED' };

      if (payment.status === 'SUCCEEDED') {
        const user = await tx.user.findUnique({ where: { id: payment.userId }, select: { accountIds: true } });
        const account = user ? await tx.account.findFirst({
          where: { id: { in: user.accountIds || [] }, type: payment.targetAccountType },
        }) : null;
        if (account) {
          await tx.account.update({
            where: { id: account.id },
            data: { availableBalance: Math.max(0, Number(account.availableBalance) - payment.amount) },
          });
        }
      }

      await tx.externalPayment.update({
        where: { id: payment.id },
        data: {
          status: 'REVIEW_REQUIRED',
          providerStatus: reason.slice(0, 80),
          failureReason: reason.slice(0, 120),
        },
      });
      return { outcome: 'FUNDS_HELD_FOR_REVIEW' };
    });
  } catch (error: any) {
    if (error?.code === 'P2002') return { outcome: 'DUPLICATE_EVENT' };
    throw error;
  }
};
