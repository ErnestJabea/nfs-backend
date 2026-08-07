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
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const penaltyCron_1 = require("./cron/penaltyCron");
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const walletRoutes_1 = __importDefault(require("./routes/walletRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const transactionIntentRoutes_1 = __importDefault(require("./routes/transactionIntentRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const paymentRoutes_1 = __importDefault(require("./routes/paymentRoutes"));
const transactionController_1 = require("./controllers/transactionController");
const swaggerConfig_1 = require("./utils/swaggerConfig");
const currencyService_1 = require("./services/currencyService");
const errorResponse_1 = require("./utils/errorResponse");
const security_1 = require("./config/security");
const responseSanitizer_1 = require("./middlewares/responseSanitizer");
const stripeService_1 = require("./services/stripeService");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
(0, security_1.validateSecurityConfiguration)();
// Middlewares
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'same-site' } }));
const corsOptions = {
    origin: function (origin, callback) {
        if ((0, security_1.isAllowedCorsOrigin)(origin))
            return callback(null, origin || true);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Idempotency-Key', 'Stripe-Signature'],
};
app.use((0, cors_1.default)(corsOptions));
app.use((0, cookie_parser_1.default)());
app.use((req, res, next) => {
    var _a;
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafeMethod && ((_a = req.cookies) === null || _a === void 0 ? void 0 : _a.token)) {
        const origin = req.get('Origin');
        if (!origin || !(0, security_1.isAllowedCorsOrigin)(origin)) {
            return res.status(403).json({ error: 'Origine de requete non autorisee.', code: 'ORIGIN_NOT_ALLOWED' });
        }
    }
    next();
});
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Raw body parser for Stripe Webhook before express.json
app.post('/api/payments/stripe/webhook', express_1.default.raw({ type: 'application/json' }), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
app.use(express_1.default.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express_1.default.urlencoded({ limit: process.env.URLENCODED_BODY_LIMIT || '256kb', extended: false }));
app.use(responseSanitizer_1.sanitizeJsonResponses);
app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
});
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/wallets', walletRoutes_1.default);
app.use('/api/admin', adminRoutes_1.default);
app.use('/api/transaction-intents', transactionIntentRoutes_1.default);
app.use('/api/notifications', notificationRoutes_1.default);
app.use('/api/payments', paymentRoutes_1.default);
// Mobile Compatibility Aliases
app.get('/api/credits', transactionController_1.getCreditsPublic);
app.use('/public/v1', authRoutes_1.default);
app.use('/secured/v1', authRoutes_1.default);
// Basic Route
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to NFS App API' });
});
// Health Check Route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
(0, swaggerConfig_1.setupSwagger)(app);
// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    return (0, errorResponse_1.sendErrorResponse)(res, err);
});
(0, penaltyCron_1.startPenaltyCron)();
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Available at http://localhost:${PORT}`);
    (0, currencyService_1.initCurrencyJob)();
});
