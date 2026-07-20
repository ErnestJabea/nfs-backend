import crypto from 'crypto';
import cron from 'node-cron';
import prisma from '../utils/prisma';
import {
  getPaymentProviderAvailability,
  verifyFlutterwavePayment,
  verifyFlutterwavePaymentByReference,
  verifyStripeCheckoutSession,
} from './paymentProviderService';
import { reconcileSuccessfulPayment, recordNonSuccessfulPaymentEvent } from './paymentSettlementService';

const successful = new Set(['SUCCESS', 'SUCCESSFUL', 'SUCCEEDED', 'PAID']);

const reconciliationEvent = (payment: any, status: string, providerId?: string) => ({
  id: crypto
    .createHash('sha256')
    .update(`reconcile:${payment.provider}:${payment.reference}:${status}:${providerId || ''}`)
    .digest('hex'),
  type: 'payment.reconciliation',
  payloadHash: crypto
    .createHash('sha256')
    .update(`${payment.reference}:${status}:${providerId || ''}`)
    .digest('hex'),
});

export const reconcilePendingPayments = async () => {
  const availability = getPaymentProviderAvailability();
  if (!availability.providers.FLUTTERWAVE.enabled && !availability.providers.STRIPE.enabled) return;

  const pending = await prisma.externalPayment.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });

  for (const payment of pending) {
    try {
      if (!['FLUTTERWAVE', 'STRIPE'].includes(payment.provider)) continue;
      const provider: 'FLUTTERWAVE' | 'STRIPE' = payment.provider === 'FLUTTERWAVE' ? 'FLUTTERWAVE' : 'STRIPE';
      const verified = provider === 'FLUTTERWAVE'
        ? payment.providerPaymentId
          ? await verifyFlutterwavePayment(payment.providerPaymentId)
          : await verifyFlutterwavePaymentByReference(payment.reference)
        : payment.providerSessionId
          ? await verifyStripeCheckoutSession(payment.providerSessionId)
          : null;
      if (!verified) continue;

      const event = reconciliationEvent(
        payment,
        verified.status,
        verified.providerPaymentId || verified.providerSessionId,
      );
      if (successful.has(verified.status)) {
        await reconcileSuccessfulPayment(provider, verified, event);
      } else if (payment.expiresAt && payment.expiresAt <= new Date()) {
        await recordNonSuccessfulPaymentEvent(provider, payment.reference, 'EXPIRED', event);
      }
    } catch (error: any) {
      console.warn(`Payment reconciliation deferred for ${payment.reference}: ${String(error?.code || 'PROVIDER_UNAVAILABLE')}`);
    }
  }
};

export const startPaymentReconciliationCron = () => {
  cron.schedule('*/5 * * * *', () => {
    reconcilePendingPayments().catch((error: any) => {
      console.error(`Payment reconciliation job failed: ${String(error?.code || error?.name || 'UNKNOWN_ERROR')}`);
    });
  });
};
