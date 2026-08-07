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
exports.cancelTransactionIntent = exports.resendTransactionOtp = exports.confirmTransactionIntent = exports.createTransactionIntent = void 0;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const security_1 = require("../config/security");
const errorResponse_1 = require("../utils/errorResponse");
const otpDeliveryService_1 = require("../services/otpDeliveryService");
const transactionExecutionService_1 = require("../services/transactionExecutionService");
const OTP_TTL_MS = 3 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_DELAY_MS = 45 * 1000;
const OTP_MAX_RESENDS = 3;
const createOtp = () => crypto_1.default.randomInt(10000000, 100000000).toString();
const canonicalize = (obj) => {
    if (obj === null || typeof obj !== 'object') {
        if (typeof obj === 'number')
            return Number(obj.toFixed(2));
        return obj;
    }
    if (Array.isArray(obj))
        return obj.map(canonicalize);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        if (obj[key] !== undefined) {
            sorted[key] = canonicalize(obj[key]);
        }
    }
    return sorted;
};
const payloadDigest = (payload) => {
    const normalized = JSON.parse(JSON.stringify(canonicalize(payload)));
    return crypto_1.default.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};
const otpDigest = (intentId, userId, payloadHash, otp) => crypto_1.default
    .createHmac('sha256', (0, security_1.getOtpHmacSecret)())
    .update(`${intentId}:${userId}:${payloadHash}:${otp}`)
    .digest('hex');
const publicIntent = (intent, extra = {}) => (Object.assign({ id: intent.id, type: intent.type, status: intent.status, summary: intent.summary, otpExpiresAt: intent.otpExpiresAt, delivery: intent.deliveryChannel ? {
        channel: intent.deliveryChannel,
        destination: intent.deliveryDestination,
    } : undefined, result: intent.status === 'COMPLETED' ? intent.result : undefined }, extra));
const getOwnedIntent = (id, userId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!/^[a-f\d]{24}$/i.test(id))
        return null;
    return prisma_1.default.transactionIntent.findFirst({ where: { id, userId } });
});
const readIdempotencyKey = (req) => { var _a; return String(req.get('Idempotency-Key') || ((_a = req.body) === null || _a === void 0 ? void 0 : _a.idempotencyKey) || '').trim(); };
const createTransactionIntent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    let createdIntentId = null;
    try {
        const userId = req.user.userId;
        const idempotencyKey = readIdempotencyKey(req);
        if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
            return res.status(400).json({ error: 'Une cle Idempotency-Key valide est requise.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
        }
        const existing = yield prisma_1.default.transactionIntent.findFirst({ where: { userId, idempotencyKey } });
        if (existing)
            return res.status(existing.status === 'COMPLETED' ? 200 : 202).json(publicIntent(existing, { replayed: true }));
        const prepared = yield (0, transactionExecutionService_1.prepareTransactionPayload)(userId, (_a = req.body) === null || _a === void 0 ? void 0 : _a.type, (_b = req.body) === null || _b === void 0 ? void 0 : _b.payload);
        const payloadHash = payloadDigest(prepared.payload);
        const id = crypto_1.default.randomBytes(12).toString('hex');
        const otp = createOtp();
        const now = new Date();
        const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);
        const user = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { phone: true, email: true },
        });
        if (!user)
            return res.status(404).json({ error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
        const intent = yield prisma_1.default.transactionIntent.create({
            data: {
                id,
                userId,
                type: prepared.type,
                payload: prepared.payload,
                payloadHash,
                summary: prepared.summary,
                otpHash: otpDigest(id, userId, payloadHash, otp),
                otpExpiresAt,
                lastOtpSentAt: now,
                idempotencyKey,
            },
        });
        createdIntentId = intent.id;
        const delivery = yield (0, otpDeliveryService_1.deliverTransactionOtp)(user, otp, prepared.summary);
        const updated = yield prisma_1.default.transactionIntent.update({
            where: { id: intent.id },
            data: { deliveryChannel: delivery.channel, deliveryDestination: delivery.destination },
        });
        return res.status(202).json(publicIntent(updated, delivery.developmentOtp ? { developmentOtp: delivery.developmentOtp } : {}));
    }
    catch (error) {
        if (createdIntentId)
            yield prisma_1.default.transactionIntent.delete({ where: { id: createdIntentId } }).catch(() => undefined);
        if ((error === null || error === void 0 ? void 0 : error.code) === 'P2002') {
            const existing = yield prisma_1.default.transactionIntent.findFirst({
                where: { userId: req.user.userId, idempotencyKey: readIdempotencyKey(req) },
            });
            if (existing)
                return res.status(202).json(publicIntent(existing, { replayed: true }));
        }
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de creer l’autorisation de transaction.');
    }
});
exports.createTransactionIntent = createTransactionIntent;
const confirmTransactionIntent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const intent = yield getOwnedIntent(String(req.params.id || ''), req.user.userId);
        if (!intent)
            return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
        if (['COMPLETED', 'PROCESSING', 'OTP_CONFIRMED'].includes(intent.status)) {
            return res.json(publicIntent(intent, { replayed: true }));
        }
        if (intent.status !== 'OTP_PENDING') {
            return res.status(409).json({ error: 'Cette autorisation ne peut plus etre confirmee.', code: 'INTENT_NOT_PENDING', status: intent.status });
        }
        if (intent.otpExpiresAt <= new Date()) {
            yield prisma_1.default.transactionIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
            return res.status(410).json({ error: 'Le code OTP a expire.', code: 'OTP_EXPIRED' });
        }
        if (intent.otpAttempts >= OTP_MAX_ATTEMPTS) {
            return res.status(423).json({ error: 'Autorisation verrouillee apres trop de tentatives.', code: 'OTP_LOCKED' });
        }
        if (payloadDigest(intent.payload) !== intent.payloadHash) {
            yield prisma_1.default.transactionIntent.update({ where: { id: intent.id }, data: { status: 'FAILED', failureReason: 'Payload integrity failure' } });
            return res.status(409).json({ error: 'Integrite de la transaction invalide.', code: 'TRANSACTION_INTEGRITY_ERROR' });
        }
        const otp = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.otp) || '').trim();
        const candidate = Buffer.from(otpDigest(intent.id, intent.userId, intent.payloadHash, otp));
        const stored = Buffer.from(intent.otpHash);
        const valid = /^\d{8}$/.test(otp) && candidate.length === stored.length && crypto_1.default.timingSafeEqual(candidate, stored);
        if (!valid) {
            const attempts = intent.otpAttempts + 1;
            yield prisma_1.default.transactionIntent.update({
                where: { id: intent.id },
                data: Object.assign({ otpAttempts: attempts }, (attempts >= OTP_MAX_ATTEMPTS ? { status: 'LOCKED' } : {})),
            });
            return res.status(400).json({
                error: attempts >= OTP_MAX_ATTEMPTS ? 'Autorisation verrouillee.' : 'Code OTP invalide.',
                code: attempts >= OTP_MAX_ATTEMPTS ? 'OTP_LOCKED' : 'OTP_INVALID',
                attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
            });
        }
        const claimed = yield prisma_1.default.transactionIntent.updateMany({
            where: { id: intent.id, userId: intent.userId, status: 'OTP_PENDING', otpAttempts: { lt: OTP_MAX_ATTEMPTS }, otpExpiresAt: { gt: new Date() } },
            data: { status: 'PROCESSING' },
        });
        if (claimed.count !== 1) {
            const current = yield prisma_1.default.transactionIntent.findUnique({ where: { id: intent.id } });
            if ((current === null || current === void 0 ? void 0 : current.status) === 'COMPLETED')
                return res.json(publicIntent(current, { replayed: true }));
            return res.status(409).json({ error: 'Autorisation deja en cours de traitement.', code: 'INTENT_ALREADY_PROCESSING' });
        }
        try {
            const result = yield (0, transactionExecutionService_1.executeTransactionIntent)(intent);
            const completed = yield prisma_1.default.transactionIntent.update({
                where: { id: intent.id },
                data: { status: 'COMPLETED', result, consumedAt: new Date(), otpHash: crypto_1.default.randomBytes(32).toString('hex') },
            });
            return res.json(publicIntent(completed));
        }
        catch (executionError) {
            yield prisma_1.default.transactionIntent.update({
                where: { id: intent.id },
                data: { status: 'FAILED', failureReason: String((executionError === null || executionError === void 0 ? void 0 : executionError.code) || 'TRANSACTION_FAILED').slice(0, 120) },
            });
            throw executionError;
        }
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de confirmer la transaction.');
    }
});
exports.confirmTransactionIntent = confirmTransactionIntent;
const resendTransactionOtp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const intent = yield getOwnedIntent(String(req.params.id || ''), req.user.userId);
        if (!intent)
            return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
        if (intent.status !== 'OTP_PENDING')
            return res.status(409).json({ error: 'Autorisation non renouvelable.', code: 'INTENT_NOT_PENDING' });
        if (intent.resendCount >= OTP_MAX_RESENDS)
            return res.status(429).json({ error: 'Nombre maximal de renvois atteint.', code: 'OTP_RESEND_LIMIT' });
        if (Date.now() - intent.lastOtpSentAt.getTime() < OTP_RESEND_DELAY_MS) {
            return res.status(429).json({ error: 'Veuillez patienter avant de demander un nouveau code.', code: 'OTP_RESEND_TOO_SOON' });
        }
        const user = yield prisma_1.default.user.findUnique({ where: { id: intent.userId }, select: { phone: true, email: true } });
        if (!user)
            return res.status(404).json({ error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
        const otp = createOtp();
        const now = new Date();
        const delivery = yield (0, otpDeliveryService_1.deliverTransactionOtp)(user, otp, intent.summary);
        const updated = yield prisma_1.default.transactionIntent.update({
            where: { id: intent.id },
            data: {
                otpHash: otpDigest(intent.id, intent.userId, intent.payloadHash, otp),
                otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
                otpAttempts: 0,
                resendCount: { increment: 1 },
                lastOtpSentAt: now,
                deliveryChannel: delivery.channel,
                deliveryDestination: delivery.destination,
            },
        });
        return res.json(publicIntent(updated, delivery.developmentOtp ? { developmentOtp: delivery.developmentOtp } : {}));
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible de renvoyer le code OTP.');
    }
});
exports.resendTransactionOtp = resendTransactionOtp;
const cancelTransactionIntent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const intent = yield getOwnedIntent(String(req.params.id || ''), req.user.userId);
        if (!intent)
            return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
        const cancelled = yield prisma_1.default.transactionIntent.updateMany({
            where: { id: intent.id, status: 'OTP_PENDING' },
            data: { status: 'CANCELLED', otpHash: crypto_1.default.randomBytes(32).toString('hex') },
        });
        if (cancelled.count !== 1)
            return res.status(409).json({ error: 'Cette autorisation ne peut plus etre annulee.', code: 'INTENT_NOT_PENDING' });
        return res.status(204).send();
    }
    catch (error) {
        return (0, errorResponse_1.sendErrorResponse)(res, error, 'Impossible d’annuler la transaction.');
    }
});
exports.cancelTransactionIntent = cancelTransactionIntent;
