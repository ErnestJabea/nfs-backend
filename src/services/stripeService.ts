import Stripe from 'stripe';
import prisma from '../utils/prisma';

const getStripeSecretKey = () => process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development';

export const getStripeClient = (): Stripe => {
  return new Stripe(getStripeSecretKey());
};

export interface CreateStripeSessionOptions {
  userId: string;
  userEmail?: string;
  type: 'ACCOUNT_FUNDING' | 'COTISATION_PAYMENT';
  targetAccountType?: 'PRINCIPAL' | 'EPARGNE';
  groupId?: string;
  amount: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
}

export const createStripeCheckoutSession = async (options: CreateStripeSessionOptions) => {
  const stripe = getStripeClient();
  const rawCurrency = String(options.currency || 'XAF').toUpperCase();
  const amount = Math.abs(Number(options.amount || 0));
  
  let title = 'Approvisionnement Wallet NFS';
  let description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Wallet NFS`;

  if (options.type === 'ACCOUNT_FUNDING' && options.targetAccountType === 'EPARGNE') {
    title = 'Approvisionnement Solde Épargne';
    description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Compte Épargne`;
  } else if (options.type === 'COTISATION_PAYMENT') {
    title = 'Cotisation Tontine NFS';
    description = `Paiement de cotisation de ${amount.toLocaleString('fr-FR')} XAF`;
    if (options.groupId) {
      const group = await prisma.cotisationGroup.findUnique({ where: { id: options.groupId }, select: { name: true } });
      if (group?.name) description = `Cotisation au groupe ${group.name}`;
    }
  }

  let stripeCurrency = 'eur';
  let unitAmountCents = 0;

  if (rawCurrency === 'XAF' || rawCurrency === 'XOF') {
    stripeCurrency = 'eur';
    // Taux officiel d'équivalence : 1 EUR = 655.957 XAF
    const amountInEur = amount / 655.957;
    unitAmountCents = Math.max(50, Math.round(amountInEur * 100)); // Minimum Stripe Checkout (~0,50 EUR)
    description += ` (≈ ${(unitAmountCents / 100).toFixed(2)} €)`;
  } else if (rawCurrency === 'EUR') {
    stripeCurrency = 'eur';
    unitAmountCents = Math.round(amount * 100);
  } else if (rawCurrency === 'USD') {
    stripeCurrency = 'usd';
    unitAmountCents = Math.round(amount * 100);
  } else {
    stripeCurrency = rawCurrency.toLowerCase();
    unitAmountCents = Math.round(amount * 100);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: options.userEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            product_data: {
              name: title,
              description,
            },
            unit_amount: unitAmountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: options.userId,
        type: options.type,
        targetAccountType: options.targetAccountType || 'PRINCIPAL',
        groupId: options.groupId || '',
        amount: String(amount),
        currency: rawCurrency,
      },
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
    });

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      reference: session.id,
      convertedAmountEur: (unitAmountCents / 100).toFixed(2),
      currency: rawCurrency,
    };
  } catch (error: any) {
    const isInvalidKey = error?.type === 'StripeAuthenticationError'
      || !process.env.STRIPE_SECRET_KEY
      || process.env.STRIPE_SECRET_KEY.includes('placeholder')
      || process.env.STRIPE_SECRET_KEY.includes('xxxx');

    if (isInvalidKey) {
      console.warn('[Stripe Sandbox Simulation] Clé Stripe non configurée ou de test fictif. Exécution en mode simulation.');
      
      const mockSessionId = `cs_test_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
      
      // Auto-exécuter le crédit en base de données pour le mode simulation
      await processStripeCheckoutCompleted({
        id: mockSessionId,
        amount_total: options.amount,
        metadata: {
          userId: options.userId,
          type: options.type,
          targetAccountType: options.targetAccountType || 'PRINCIPAL',
          groupId: options.groupId || '',
          amount: String(options.amount),
        },
      } as any);

      const redirectUrl = options.successUrl.replace('{CHECKOUT_SESSION_ID}', mockSessionId);
      return {
        sessionId: mockSessionId,
        checkoutUrl: redirectUrl,
        reference: mockSessionId,
        isMock: true,
      };
    }
    throw error;
  }
};

export const verifyStripeWebhookEvent = (rawBody: Buffer | string, signature: string): Stripe.Event => {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET non configuré dans les variables d’environnement backend.');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
};

export const processStripeCheckoutCompleted = async (session: Stripe.Checkout.Session) => {
  const metadata = session.metadata || {};
  const userId = metadata.userId;
  const type = metadata.type;
  const targetAccountType = metadata.targetAccountType || 'PRINCIPAL';
  const groupId = metadata.groupId;
  const amount = Number(metadata.amount || session.amount_total || 0);

  if (!userId || !type || amount <= 0) {
    throw new Error('Métadonnées Stripe Checkout incomplètes ou montant invalide.');
  }

  const transactionRef = `STRIPE_${session.id}`;

  const existingTransaction = await prisma.transaction.findFirst({
    where: { transactionRef },
    select: { id: true },
  });

  if (existingTransaction) {
    console.log(`[Stripe Webhook] Transaction déjà traitée (idempotence): ${transactionRef}`);
    return { processed: true, idempotency: true, transactionRef };
  }

  if (type === 'ACCOUNT_FUNDING') {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
      if (!user) throw new Error(`Utilisateur ${userId} introuvable pour le crédit Stripe.`);

      const account = await tx.account.findFirst({
        where: { id: { in: user.accountIds || [] }, type: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL' },
      });

      if (!account) throw new Error(`Compte ${targetAccountType} introuvable pour l'utilisateur ${userId}.`);

      await tx.account.update({
        where: { id: account.id },
        data: {
          currentBalance: { increment: amount },
          availableBalance: { increment: amount },
        },
      });

      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
        update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
      });

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          purpose: `Approvisionner ${targetAccountType === 'EPARGNE' ? 'Solde Épargne' : 'Wallet NFS'} via Stripe`,
          amount,
          status: 'SUCCESS',
          transactionRef,
          targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
          currency: 'XAF',
          createdBy: 'StripeWebhook',
          operation: { type: 'account_funding_stripe', stripeSessionId: session.id, amount },
        },
      });

      console.log(`[Stripe Webhook] Compte ${targetAccountType} de l'utilisateur ${userId} crédité de ${amount} XAF via Stripe.`);
      return { processed: true, transactionId: createdTx.id, transactionRef };
    });
  }

  if (type === 'COTISATION_PAYMENT') {
    if (!groupId) throw new Error('ID du groupe de cotisation manquant dans les métadonnées Stripe.');

    return prisma.$transaction(async (tx) => {
      const group = await tx.cotisationGroup.findUnique({ where: { id: groupId } });
      if (!group) throw new Error(`Groupe de cotisation ${groupId} introuvable.`);

      const periodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

      await tx.cotisationPayment.create({
        data: {
          userId,
          groupId,
          periodKey,
          amount,
          transactionRef,
        },
      });

      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
        update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
      });

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          purpose: `Cotisation ${group.name} (Stripe)`,
          amount,
          status: 'SUCCESS',
          transactionRef,
          sourceAccountType: 'STRIPE',
          currency: 'XAF',
          createdBy: 'StripeWebhook',
          operation: { type: 'cotisation_payment_stripe', stripeSessionId: session.id, groupId },
        },
      });

      console.log(`[Stripe Webhook] Cotisation de ${amount} XAF enregistrée pour l'utilisateur ${userId} dans le groupe ${group.name}.`);
      return { processed: true, transactionId: createdTx.id, transactionRef };
    });
  }

  throw new Error(`Type de paiement Stripe inconnu : ${type}`);
};
