import prisma from '../utils/prisma';
import { createProviderCheckout } from './paymentProviderService';

export const publicExternalPayment = (payment: any) => ({
  reference: payment.reference,
  provider: payment.provider,
  method: payment.method,
  targetAccountType: payment.targetAccountType,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  providerStatus: payment.providerStatus,
  checkoutUrl: payment.checkoutUrl,
  creditedAt: payment.creditedAt,
  expiresAt: payment.expiresAt,
  createdAt: payment.createdAt,
});

export const createFundingCheckout = async (intent: any, payload: any) => {
  const existing = await prisma.externalPayment.findUnique({ where: { intentId: intent.id } });
  if (existing) return publicExternalPayment(existing);

  const customer = await prisma.user.findUnique({
    where: { id: intent.userId },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      kycStatus: true,
    },
  });
  if (!customer) {
    const error: any = new Error('Utilisateur introuvable.');
    error.status = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  const requireKyc = String(process.env.PAYMENTS_REQUIRE_APPROVED_KYC || '').toLowerCase() === 'true'
    || process.env.NODE_ENV === 'production';
  if (requireKyc && String(customer.kycStatus || '').toUpperCase() !== 'APPROVED') {
    const error: any = new Error('Un KYC approuve est requis pour approvisionner un compte.');
    error.status = 403;
    error.code = 'KYC_REQUIRED';
    throw error;
  }

  const reference = `NFS_${String(intent.id).toUpperCase()}`;
  const payment = await prisma.externalPayment.create({
    data: {
      userId: intent.userId,
      intentId: intent.id,
      provider: payload.provider,
      method: payload.method,
      targetAccountType: payload.targetAccountType,
      amount: payload.amount,
      currency: 'XAF',
      reference,
      status: 'CREATING',
      creditedAt: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  try {
    const checkout = await createProviderCheckout(payment, {
      ...customer,
      phone: payload.phone || customer.phone,
    });
    const updated = await prisma.externalPayment.update({
      where: { id: payment.id },
      data: {
        checkoutUrl: checkout.checkoutUrl,
        providerSessionId: checkout.providerSessionId,
        providerPaymentId: checkout.providerPaymentId,
        providerStatus: checkout.providerStatus,
        status: 'PENDING',
      },
    });
    return {
      ...publicExternalPayment(updated),
      instructions: checkout.instructions,
    };
  } catch (error: any) {
    await prisma.externalPayment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: String(error?.code || 'PAYMENT_INITIALIZATION_FAILED').slice(0, 120),
      },
    }).catch(() => undefined);
    throw error;
  }
};
