"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processStripeCheckoutCompleted = exports.verifyStripeWebhookEvent = exports.createStripeCheckoutSession = exports.getStripeClient = void 0;
const stripe_1 = __importDefault(require("stripe"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const mailer_1 = require("../utils/mailer");
const getStripeSecretKey = () => process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key_for_development';
const getStripeClient = () => {
    return new stripe_1.default(getStripeSecretKey());
};
exports.getStripeClient = getStripeClient;
const createStripeCheckoutSession = (options) => __awaiter(void 0, void 0, void 0, function* () {
    const stripe = (0, exports.getStripeClient)();
    const rawCurrency = String(options.currency || 'XAF').toUpperCase();
    const amount = Math.abs(Number(options.amount || 0));
    let title = 'Approvisionnement Wallet NFS';
    let description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Wallet NFS`;
    if (options.type === 'ACCOUNT_FUNDING' && options.targetAccountType === 'EPARGNE') {
        title = 'Approvisionnement Solde Épargne';
        description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Compte Épargne`;
    }
    else if (options.type === 'COTISATION_PAYMENT') {
        title = 'Cotisation Tontine NFS';
        description = `Paiement de cotisation de ${amount.toLocaleString('fr-FR')} XAF`;
        if (options.groupId) {
            const group = yield prisma_1.default.cotisationGroup.findUnique({ where: { id: options.groupId }, select: { name: true } });
            if (group === null || group === void 0 ? void 0 : group.name)
                description = `Cotisation au groupe ${group.name}`;
        }
    }
    let stripeCurrency = 'eur';
    let unitAmountCents = 0;
    if (rawCurrency === 'XAF' || rawCurrency === 'XOF') {
        stripeCurrency = 'eur';
        const amountInEur = amount / 655.957;
        unitAmountCents = Math.max(50, Math.round(amountInEur * 100));
        description += ` (≈ ${(unitAmountCents / 100).toFixed(2)} €)`;
    }
    else if (rawCurrency === 'EUR') {
        stripeCurrency = 'eur';
        unitAmountCents = Math.round(amount * 100);
    }
    else if (rawCurrency === 'USD') {
        stripeCurrency = 'usd';
        unitAmountCents = Math.round(amount * 100);
    }
    else {
        stripeCurrency = rawCurrency.toLowerCase();
        unitAmountCents = Math.round(amount * 100);
    }
    try {
        const session = yield stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: options.userEmail || undefined,
            invoice_creation: {
                enabled: true,
            },
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
    }
    catch (error) {
        const isInvalidKey = (error === null || error === void 0 ? void 0 : error.type) === 'StripeAuthenticationError'
            || !process.env.STRIPE_SECRET_KEY
            || process.env.STRIPE_SECRET_KEY.includes('placeholder')
            || process.env.STRIPE_SECRET_KEY.includes('xxxx');
        if (isInvalidKey) {
            console.warn('[Stripe Sandbox Simulation] Clé Stripe non configurée ou de test fictif. Exécution en mode simulation.');
            const mockSessionId = `cs_test_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`;
            yield (0, exports.processStripeCheckoutCompleted)({
                id: mockSessionId,
                amount_total: options.amount,
                metadata: {
                    userId: options.userId,
                    type: options.type,
                    targetAccountType: options.targetAccountType || 'PRINCIPAL',
                    groupId: options.groupId || '',
                    amount: String(options.amount),
                },
            });
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
});
exports.createStripeCheckoutSession = createStripeCheckoutSession;
const verifyStripeWebhookEvent = (rawBody, signature) => {
    const stripe = (0, exports.getStripeClient)();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET non configuré dans les variables d’environnement backend.');
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
};
exports.verifyStripeWebhookEvent = verifyStripeWebhookEvent;
const processStripeCheckoutCompleted = (session) => __awaiter(void 0, void 0, void 0, function* () {
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
    const existingTransaction = yield prisma_1.default.transaction.findFirst({
        where: { transactionRef },
        select: { id: true },
    });
    if (existingTransaction) {
        console.log(`[Stripe Webhook] Transaction déjà traitée (idempotence): ${transactionRef}`);
        return { processed: true, idempotency: true, transactionRef };
    }
    let result;
    if (type === 'ACCOUNT_FUNDING') {
        result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield tx.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
            if (!user)
                throw new Error(`Utilisateur ${userId} introuvable pour le crédit Stripe.`);
            let account = yield tx.account.findFirst({
                where: { id: { in: user.accountIds || [] }, type: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL' },
            });
            if (!account) {
                console.log(`[Stripe Webhook] Création automatique du compte ${targetAccountType} pour l'utilisateur ${userId}...`);
                account = yield tx.account.create({
                    data: {
                        type: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
                        currency: 'XAF',
                        currentBalance: 0,
                        availableBalance: 0,
                    },
                });
                yield tx.user.update({
                    where: { id: userId },
                    data: { accountIds: { push: account.id } },
                });
            }
            yield tx.account.update({
                where: { id: account.id },
                data: {
                    currentBalance: { increment: amount },
                    availableBalance: { increment: amount },
                },
            });
            yield tx.systemBalance.upsert({
                where: { code: 'NFS_GLOBAL' },
                create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
                update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
            });
            const createdTx = yield tx.transaction.create({
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
        }));
    }
    else if (type === 'COTISATION_PAYMENT') {
        if (!groupId)
            throw new Error('ID du groupe de cotisation manquant dans les métadonnées Stripe.');
        result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const group = yield tx.cotisationGroup.findUnique({ where: { id: groupId } });
            if (!group)
                throw new Error(`Groupe de cotisation ${groupId} introuvable.`);
            const periodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
            yield tx.cotisationPayment.create({
                data: {
                    userId,
                    groupId,
                    periodKey,
                    amount,
                    transactionRef,
                },
            });
            yield tx.systemBalance.upsert({
                where: { code: 'NFS_GLOBAL' },
                create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
                update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
            });
            const createdTx = yield tx.transaction.create({
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
        }));
    }
    else {
        throw new Error(`Type de paiement Stripe inconnu : ${type}`);
    }
    // Envoi asynchrone de l'email de confirmation et de la facture NFS App au client
    prisma_1.default.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, lastName: true } })
        .then((u) => {
        if (u === null || u === void 0 ? void 0 : u.email) {
            (0, mailer_1.sendTransactionInvoiceEmail)({
                userEmail: u.email,
                userName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
                transactionRef,
                title: type === 'COTISATION_PAYMENT'
                    ? 'Cotisation Tontine NFS'
                    : (targetAccountType === 'EPARGNE' ? 'Approvisionnement Solde Épargne' : 'Approvisionnement Wallet NFS'),
                amount,
                currency: 'XAF',
            }).catch((err) => console.error('[Invoice Email Send Error]:', err));
        }
    })
        .catch((err) => console.error('[Invoice User Fetch Error]:', err));
    return result;
});
exports.processStripeCheckoutCompleted = processStripeCheckoutCompleted;
