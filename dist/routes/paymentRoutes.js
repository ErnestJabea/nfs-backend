"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const express_1 = __importStar(require("express"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const stripeService_1 = require("../services/stripeService");
const prisma_1 = __importDefault(require("../utils/prisma"));
const router = (0, express_1.Router)();
router.get('/providers', (_req, res) => {
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
                id: 'FLUTTERWAVE',
                name: 'Flutterwave',
                enabled: false,
                methods: [],
            },
        ],
    });
});
// Endpoint authentifié pour créer une session Stripe Checkout (Wallet, Épargne ou Cotisation)
router.post('/stripe/create-checkout-session', authMiddleware_1.authMiddleware, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.userId;
        const user = yield prisma_1.default.user.findUnique({ where: { id: userId }, select: { email: true } });
        const { type, targetAccountType, groupId, amount, currency, successUrl, cancelUrl } = req.body;
        const session = yield (0, stripeService_1.createStripeCheckoutSession)({
            userId,
            userEmail: (user === null || user === void 0 ? void 0 : user.email) || undefined,
            type: type === 'COTISATION_PAYMENT' ? 'COTISATION_PAYMENT' : 'ACCOUNT_FUNDING',
            targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
            groupId: groupId ? String(groupId) : undefined,
            amount: Number(amount),
            currency: currency || 'XAF',
            successUrl: String(successUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?reference={CHECKOUT_SESSION_ID}`),
            cancelUrl: String(cancelUrl || `${req.headers.origin || 'https://app.nfs.ejabbing.com'}/funding?cancelled=true`),
        });
        return res.json(session);
    }
    catch (error) {
        console.error('[Stripe Create Session Error]:', error);
        return res.status(400).json({ error: error.message || 'Impossible de créer la session Stripe Checkout.' });
    }
}));
// Endpoint Webhook Stripe public avec raw body
router.post('/stripe/webhook', express_1.default.raw({ type: 'application/json' }), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        return res.status(400).send('En-tête Stripe-Signature manquant.');
    }
    let event;
    try {
        event = (0, stripeService_1.verifyStripeWebhookEvent)(req.body, sig);
    }
    catch (err) {
        console.error(`[Stripe Webhook Signature Error]: ${err.message}`);
        return res.status(400).send(`Signature Webhook invalide : ${err.message}`);
    }
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            yield (0, stripeService_1.processStripeCheckoutCompleted)(session);
        }
        return res.json({ received: true });
    }
    catch (err) {
        console.error(`[Stripe Webhook Processing Error]: ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
}));
router.get('/:reference', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const refStr = String(req.params.reference || '').trim();
    const lowerRef = refStr.toLowerCase();
    let transaction = yield prisma_1.default.transaction.findFirst({
        where: {
            OR: [
                { transactionRef: refStr },
                { transactionRef: lowerRef },
                { transactionRef: `STRIPE_${refStr}` },
                { transactionRef: `STRIPE_${lowerRef}` },
            ],
        },
    });
    // Si la transaction n'est pas encore en base de données et concerne une session Stripe (ex. cs_test_...), vérifier en direct auprès de l'API Stripe
    if (!transaction && (refStr.startsWith('cs_') || lowerRef.startsWith('cs_'))) {
        try {
            const stripe = (0, stripeService_1.getStripeClient)();
            const session = yield stripe.checkout.sessions.retrieve(refStr);
            if (session && session.payment_status === 'paid') {
                console.log(`[Stripe Sync Check] Verification directe reussie pour la session ${refStr}. Execution du credit...`);
                yield (0, stripeService_1.processStripeCheckoutCompleted)(session);
                transaction = yield prisma_1.default.transaction.findFirst({
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
        }
        catch (err) {
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
}));
exports.default = router;
