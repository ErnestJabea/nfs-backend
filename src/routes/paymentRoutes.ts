import express, { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  createStripeCheckoutSession,
  verifyStripeWebhookEvent,
  processStripeCheckoutCompleted,
  getStripeClient,
} from '../services/stripeService';
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
        methods: ['CARD'],
        publishableKey: stripePublishableKey,
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

router.get('/:reference', async (req: Request, res: Response) => {
  const refStr = String(req.params.reference || '');
  let transaction = await prisma.transaction.findFirst({
    where: { OR: [{ transactionRef: refStr }, { transactionRef: `STRIPE_${refStr}` }] },
  });

  // Si la transaction n'est pas encore en base de données et concerne une session Stripe (ex. cs_test_...), vérifier en direct auprès de l'API Stripe
  if (!transaction && refStr.startsWith('cs_')) {
    try {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(refStr);
      if (session && session.payment_status === 'paid') {
        console.log(`[Stripe Sync Check] Verification directe reussie pour la session ${refStr}. Execution du credit...`);
        await processStripeCheckoutCompleted(session);
        transaction = await prisma.transaction.findFirst({
          where: { OR: [{ transactionRef: refStr }, { transactionRef: `STRIPE_${refStr}` }] },
        });
      }
    } catch (err: any) {
      console.warn(`[Stripe Direct Sync Warn] ${err.message}`);
    }
  }

  if (transaction) {
    return res.json({
      reference: transaction.transactionRef,
      status: transaction.status === 'SUCCESS' ? 'SUCCEEDED' : transaction.status,
      amount: Math.abs(Number(transaction.amount || 0)),
      currency: transaction.currency || 'XAF',
      message: 'Paiement Stripe vérifié avec succès.',
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
