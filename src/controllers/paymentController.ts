import crypto from 'crypto';
import { Response } from 'express';
import prisma from '../utils/prisma';
import { publicExternalPayment } from '../services/paymentInitiationService';
import {
  constructStripeEvent,
  getPaymentProviderAvailability,
  isValidFlutterwaveSignature,
  PaymentProviderError,
  verifyFlutterwavePayment,
  verifyStripeCheckoutSession,
} from '../services/paymentProviderService';
import {
  reconcileSuccessfulPayment,
  recordPaymentRiskEvent,
  recordNonSuccessfulPaymentEvent,
} from '../services/paymentSettlementService';

const rawBody = (req: any) => {
  if (!Buffer.isBuffer(req.body)) {
    const error: any = new Error('Corps webhook brut requis.');
    error.status = 400;
    error.code = 'RAW_WEBHOOK_BODY_REQUIRED';
    throw error;
  }
  return req.body as Buffer;
};

const payloadHash = (body: Buffer) => crypto.createHash('sha256').update(body).digest('hex');

const webhookError = (res: Response, error: any) => {
  const status = error instanceof PaymentProviderError
    ? error.status
    : Number(error?.status || 500);
  return res.status(status >= 400 && status <= 599 ? status : 500).json({
    error: status >= 500 ? 'Traitement du webhook temporairement indisponible.' : error.message,
    code: error?.code || 'PAYMENT_WEBHOOK_ERROR',
  });
};

export const getPaymentProviders = async (_req: any, res: Response) => {
  const availability = getPaymentProviderAvailability();
  return res.json({
    environment: availability.environment,
    providers: [
      {
        id: 'FLUTTERWAVE',
        enabled: availability.providers.FLUTTERWAVE.enabled,
        methods: availability.providers.FLUTTERWAVE.methods,
      },
      {
        id: 'STRIPE',
        enabled: availability.providers.STRIPE.enabled,
        methods: availability.providers.STRIPE.methods,
      },
    ],
  });
};

export const getPaymentStatus = async (req: any, res: Response) => {
  const reference = String(req.params.reference || '').toUpperCase();
  if (!/^NFS_[A-F\d]{24}$/.test(reference)) {
    return res.status(400).json({ error: 'Reference de paiement invalide.', code: 'INVALID_PAYMENT_REFERENCE' });
  }
  const payment = await prisma.externalPayment.findFirst({
    where: { reference, userId: req.user.userId },
  });
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable.', code: 'PAYMENT_NOT_FOUND' });
  return res.json(publicExternalPayment(payment));
};

export const listPaymentsForAdministration = async (req: any, res: Response) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '25'), 10) || 25));
  const status = String(req.query.status || '').toUpperCase();
  const provider = String(req.query.provider || '').toUpperCase();
  const where = {
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
  };
  const [payments, total] = await Promise.all([
    prisma.externalPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        reference: true,
        provider: true,
        method: true,
        targetAccountType: true,
        amount: true,
        currency: true,
        status: true,
        providerStatus: true,
        failureReason: true,
        providerPaymentId: true,
        creditedTransactionId: true,
        creditedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.externalPayment.count({ where }),
  ]);
  return res.json({ data: payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
};

export const handleFlutterwaveWebhook = async (req: any, res: Response) => {
  try {
    const body = rawBody(req);
    if (!isValidFlutterwaveSignature(
      body,
      req.get('flutterwave-signature'),
      req.get('verif-hash'),
    )) {
      return res.status(401).json({ error: 'Signature webhook invalide.', code: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    const payload = JSON.parse(body.toString('utf8'));
    const data = payload.data || {};
    const event = {
      id: String(payload.webhook_id || payload.id || payloadHash(body)),
      type: String(payload.type || payload.event || 'flutterwave.event'),
      payloadHash: payloadHash(body),
    };
    const providerStatus = String(data.status || payload.status || '').toUpperCase();
    const transactionId = String(data.id || payload.transaction_id || '');
    const webhookReference = String(data.tx_ref || data.reference || payload.tx_ref || '');
    const looksSuccessful = ['SUCCESS', 'SUCCESSFUL', 'SUCCEEDED'].includes(providerStatus)
      || /charge\.completed|payment\.completed/i.test(event.type);

    if (/refund|chargeback|dispute/i.test(event.type)) {
      await recordPaymentRiskEvent('FLUTTERWAVE', {
        reference: webhookReference || undefined,
        providerPaymentId: transactionId || undefined,
      }, event.type.toUpperCase(), event);
    } else if (looksSuccessful) {
      if (!transactionId) return res.status(400).json({ error: 'Identifiant de transaction manquant.', code: 'INVALID_WEBHOOK_PAYLOAD' });
      const verified = await verifyFlutterwavePayment(transactionId);
      await reconcileSuccessfulPayment('FLUTTERWAVE', verified, event);
    } else {
      const recordedStatus = providerStatus === 'FAILED' ? 'ATTEMPT_FAILED' : providerStatus;
      await recordNonSuccessfulPaymentEvent('FLUTTERWAVE', webhookReference || undefined, recordedStatus, event);
    }
    return res.status(200).json({ received: true });
  } catch (error: any) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Webhook JSON invalide.', code: 'INVALID_WEBHOOK_PAYLOAD' });
    return webhookError(res, error);
  }
};

export const handleStripeWebhook = async (req: any, res: Response) => {
  try {
    const body = rawBody(req);
    const signature = String(req.get('stripe-signature') || '');
    if (!signature) return res.status(401).json({ error: 'Signature webhook manquante.', code: 'INVALID_WEBHOOK_SIGNATURE' });
    let stripeEvent;
    try {
      stripeEvent = constructStripeEvent(body, signature);
    } catch {
      return res.status(401).json({ error: 'Signature webhook invalide.', code: 'INVALID_WEBHOOK_SIGNATURE' });
    }

    const object: any = stripeEvent.data.object;
    const event = {
      id: stripeEvent.id,
      type: stripeEvent.type,
      payloadHash: payloadHash(body),
    };
    if (['charge.refunded', 'charge.dispute.created', 'charge.dispute.updated'].includes(stripeEvent.type)) {
      await recordPaymentRiskEvent('STRIPE', {
        reference: String(object.metadata?.nfs_payment_reference || '') || undefined,
        providerPaymentId: String(object.payment_intent || '') || undefined,
      }, stripeEvent.type.toUpperCase(), event);
    } else if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(stripeEvent.type)) {
      const verified = await verifyStripeCheckoutSession(String(object.id));
      await reconcileSuccessfulPayment('STRIPE', verified, event);
    } else {
      const reference = String(object.client_reference_id || object.metadata?.nfs_payment_reference || '');
      const providerStatus = stripeEvent.type === 'checkout.session.expired'
        ? 'EXPIRED'
        : stripeEvent.type === 'checkout.session.async_payment_failed' ? 'FAILED' : String(object.status || 'EVENT');
      await recordNonSuccessfulPaymentEvent('STRIPE', reference || undefined, providerStatus.toUpperCase(), event);
    }
    return res.status(200).json({ received: true });
  } catch (error: any) {
    return webhookError(res, error);
  }
};
