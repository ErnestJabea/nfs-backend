import express, { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  createStripeCheckoutSession,
  verifyStripeWebhookEvent,
  processStripeCheckoutCompleted,
  getStripeClient,
} from '../services/stripeService';
import {
  createEnkapOrder,
  getEnkapOrderStatus,
  processEnkapOrderCompleted,
} from '../services/enkapService';
import { handleEnkapWebhookNotification } from '../controllers/enkapController';
import prisma from '../utils/prisma';


const router = Router();

router.get('/providers', (_req: Request, res: Response) => {
  const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

  return res.json({
    providers: [
      {
        id: 'STRIPE',
        name: 'Stripe',
        enabled: true,
        methods: ['CARD', 'ORANGE_MONEY', 'MTN_MOMO'],
        publishableKey: stripePublishableKey,
      },
      {
        id: 'ENKAP',
        name: 'Paiement Mobile Local (Orange / MTN)',
        enabled: true,
        methods: ['ORANGE_MONEY', 'MTN_MOMO', 'EXPRESS_UNION', 'CARTE'],
      },
      {
        id: 'FLUTTERWAVE',
        name: 'Flutterwave',
        enabled: false,
        methods: [],
      },
    ],
  });
});

// Endpoint authentifié pour créer une session Stripe Checkout (Wallet, Épargne ou Cotisation)
router.post('/stripe/create-checkout-session', authMiddleware, async (req: any, res: Response) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const { type, targetAccountType, groupId, amount, currency, successUrl, cancelUrl } = req.body;

    const session = await createStripeCheckoutSession({
      userId,
      userEmail: user?.email || undefined,
      type: type === 'COTISATION_PAYMENT' ? 'COTISATION_PAYMENT' : 'ACCOUNT_FUNDING',
      targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
      groupId: groupId ? String(groupId) : undefined,
      amount: Number(amount),
      currency: currency || 'XAF',
      successUrl: String(successUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?reference={CHECKOUT_SESSION_ID}`),
      cancelUrl: String(cancelUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?cancelled=true`),
    });

    return res.json(session);
  } catch (error: any) {
    console.error('[Stripe Create Session Error]:', error);
    return res.status(400).json({ error: error.message || 'Impossible de créer la session Stripe Checkout.' });
  }
});

// Endpoint Webhook Stripe public avec raw body
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).send('En-tête Stripe-Signature manquant.');
  }

  let event: any;
  try {
    event = verifyStripeWebhookEvent(req.body, sig as string);
  } catch (err: any) {
    console.error(`[Stripe Webhook Signature Error]: ${err.message}`);
    return res.status(400).send(`Signature Webhook invalide : ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await processStripeCheckoutCompleted(session);
    }
    return res.json({ received: true });
  } catch (err: any) {
    console.error(`[Stripe Webhook Processing Error]: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// --- Endpoints Enkap (Maviance Sandbox Kori) ---

// Endpoint authentifié pour créer une commande Enkap
router.post('/enkap/create-order', authMiddleware, async (req: any, res: Response) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true, phone: true },
    });
    const { type, targetAccountType, groupId, amount, currency, returnUrl } = req.body;

    const result = await createEnkapOrder({
      userId,
      customerName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : undefined,
      userEmail: user?.email || undefined,
      phoneNumber: user?.phone || undefined,
      type: type === 'COTISATION_PAYMENT' ? 'COTISATION_PAYMENT' : 'ACCOUNT_FUNDING',
      targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
      groupId: groupId ? String(groupId) : undefined,
      amount: Number(amount),
      currency: currency || 'XAF',
      returnUrl: String(returnUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?reference={ORDER_REF}`),
    });

    return res.json({
      ...result,
      checkoutUrl: result.paymentUrl,
    });
  } catch (error: any) {
    console.error('[Enkap Create Order Route Error]:', error);
    return res.status(400).json({ error: error.message || 'Impossible de créer la commande Enkap.' });
  }
});

router.post('/enkap/collect', authMiddleware, async (req: any, res: Response) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true, phone: true },
    });
    const { type, targetAccountType, groupId, amount, currency, returnUrl, phone } = req.body;

    const result = await createEnkapOrder({
      userId,
      customerName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : undefined,
      userEmail: user?.email || undefined,
      phoneNumber: phone || user?.phone || undefined,
      type: type === 'COTISATION_PAYMENT' ? 'COTISATION_PAYMENT' : 'ACCOUNT_FUNDING',
      targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
      groupId: groupId ? String(groupId) : undefined,
      amount: Number(amount),
      currency: currency || 'XAF',
      returnUrl: String(returnUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?account=${targetAccountType || 'PRINCIPAL'}&reference={ORDER_REF}`),
    });

    return res.json({
      ...result,
      checkoutUrl: result.paymentUrl,
    });
  } catch (error: any) {
    console.error('[Enkap Collect Route Error]:', error);
    return res.status(400).json({ error: error.message || 'Impossible de créer la commande Enkap.' });
  }
});

// Endpoint Webhook / Callback Notification public Enkap (Zero-Trust)
router.all(['/enkap/notification', '/enkap/notification/:merchantReference'], handleEnkapWebhookNotification);


// Endpoint d'inspection directe du statut d'une commande Enkap
router.get('/enkap/status/:orderMerchantId', async (req: Request, res: Response) => {
  try {
    const orderMerchantId = String(req.params.orderMerchantId);
    const statusData = await getEnkapOrderStatus(orderMerchantId);
    return res.json(statusData || { status: 'UNKNOWN' });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/:reference', async (req: Request, res: Response) => {
  const refStr = String(req.params.reference || '').trim();
  const lowerRef = refStr.toLowerCase();

  let transaction = await prisma.transaction.findFirst({
    where: {
      OR: [
        { transactionRef: refStr },
        { transactionRef: lowerRef },
        { transactionRef: `STRIPE_${refStr}` },
        { transactionRef: `STRIPE_${lowerRef}` },
        { transactionRef: `ENKAP_${refStr}` },
        { transactionRef: `ENKAP_${lowerRef}` },
      ],
    },
  });

  // Si la transaction n'est pas encore en base de données et concerne une session Stripe (ex. cs_test_...), vérifier en direct auprès de l'API Stripe
  if (!transaction && (refStr.startsWith('cs_') || lowerRef.startsWith('cs_'))) {
    try {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(refStr);
      if (session && session.payment_status === 'paid') {
        console.log(`[Stripe Sync Check] Verification directe reussie pour la session ${refStr}. Execution du credit...`);
        await processStripeCheckoutCompleted(session);
        transaction = await prisma.transaction.findFirst({
          where: {
            OR: [
              { transactionRef: refStr },
              { transactionRef: lowerRef },
              { transactionRef: `STRIPE_${refStr}` },
              { transactionRef: `STRIPE_${lowerRef}` },
            ],
          },
        });
      }
    } catch (err: any) {
      console.warn(`[Stripe Direct Sync Warn] ${err.message}`);
    }
  }

  // Si la transaction n'est pas encore en base de données et concerne Enkap (ex. ENKAP_...), vérifier en direct
  if (!transaction && (refStr.startsWith('ENKAP_') || lowerRef.startsWith('enkap_'))) {
    try {
      const enkapStatus = await getEnkapOrderStatus(refStr);
      if (enkapStatus && (enkapStatus.status === 'SUCCESS' || enkapStatus.status === 'PAID')) {
        const refParts = (enkapStatus.optRefTwo || '').split(':');
        await processEnkapOrderCompleted({
          orderMerchantId: refStr,
          txid: enkapStatus.txid,
          userId: enkapStatus.optRefOne,
          type: refParts[0] === 'COTISATION_PAYMENT' ? 'COTISATION_PAYMENT' : 'ACCOUNT_FUNDING',
          targetAccountType: refParts[1] === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
          groupId: refParts[2] || undefined,
          amount: Number(enkapStatus.totalAmount || enkapStatus.amount || 0),
        });

        transaction = await prisma.transaction.findFirst({
          where: {
            OR: [
              { transactionRef: refStr },
              { transactionRef: `ENKAP_${refStr}` },
            ],
          },
        });
      }
    } catch (err: any) {
      console.warn(`[Enkap Direct Sync Warn] ${err.message}`);
    }
  }

  if (transaction) {
    return res.json({
      reference: transaction.transactionRef,
      status: transaction.status === 'SUCCESS' ? 'SUCCEEDED' : transaction.status,
      amount: Math.abs(Number(transaction.amount || 0)),
      currency: transaction.currency || 'XAF',
      message: 'Paiement vérifié avec succès.',
    });
  }

  return res.json({
    reference: refStr,
    status: 'PENDING',
    amount: 0,
    currency: 'XAF',
    message: 'Paiement en cours de vérification.',
  });
});

export default router;

