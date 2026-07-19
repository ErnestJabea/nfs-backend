import { Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { getOtpHmacSecret } from '../config/security';
import { sendErrorResponse } from '../utils/errorResponse';
import { deliverTransactionOtp } from '../services/otpDeliveryService';
import { executeTransactionIntent, prepareTransactionPayload } from '../services/transactionExecutionService';

const OTP_TTL_MS = 3 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_DELAY_MS = 45 * 1000;
const OTP_MAX_RESENDS = 3;

const createOtp = () => crypto.randomInt(10_000_000, 100_000_000).toString();
const payloadDigest = (payload: unknown) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const otpDigest = (intentId: string, userId: string, payloadHash: string, otp: string) => crypto
  .createHmac('sha256', getOtpHmacSecret())
  .update(`${intentId}:${userId}:${payloadHash}:${otp}`)
  .digest('hex');

const publicIntent = (intent: any, extra: Record<string, unknown> = {}) => ({
  id: intent.id,
  type: intent.type,
  status: intent.status,
  summary: intent.summary,
  otpExpiresAt: intent.otpExpiresAt,
  delivery: intent.deliveryChannel ? {
    channel: intent.deliveryChannel,
    destination: intent.deliveryDestination,
  } : undefined,
  result: intent.status === 'COMPLETED' ? intent.result : undefined,
  ...extra,
});

const getOwnedIntent = async (id: string, userId: string) => {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return prisma.transactionIntent.findFirst({ where: { id, userId } });
};

const readIdempotencyKey = (req: any) => String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();

export const createTransactionIntent = async (req: any, res: Response) => {
  let createdIntentId: string | null = null;
  try {
    const userId = req.user.userId;
    const idempotencyKey = readIdempotencyKey(req);
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'Une cle Idempotency-Key valide est requise.', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    const existing = await prisma.transactionIntent.findFirst({ where: { userId, idempotencyKey } });
    if (existing) return res.status(existing.status === 'COMPLETED' ? 200 : 202).json(publicIntent(existing, { replayed: true }));

    const prepared = await prepareTransactionPayload(userId, req.body?.type, req.body?.payload);
    const payloadHash = payloadDigest(prepared.payload);
    const id = crypto.randomBytes(12).toString('hex');
    const otp = createOtp();
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, email: true },
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });

    const intent = await prisma.transactionIntent.create({
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

    const delivery = await deliverTransactionOtp(user, otp, prepared.summary);
    const updated = await prisma.transactionIntent.update({
      where: { id: intent.id },
      data: { deliveryChannel: delivery.channel, deliveryDestination: delivery.destination },
    });
    return res.status(202).json(publicIntent(updated, delivery.developmentOtp ? { developmentOtp: delivery.developmentOtp } : {}));
  } catch (error: any) {
    if (createdIntentId) await prisma.transactionIntent.delete({ where: { id: createdIntentId } }).catch(() => undefined);
    if (error?.code === 'P2002') {
      const existing = await prisma.transactionIntent.findFirst({
        where: { userId: req.user.userId, idempotencyKey: readIdempotencyKey(req) },
      });
      if (existing) return res.status(202).json(publicIntent(existing, { replayed: true }));
    }
    return sendErrorResponse(res, error, 'Impossible de creer l’autorisation de transaction.');
  }
};

export const confirmTransactionIntent = async (req: any, res: Response) => {
  try {
    const intent = await getOwnedIntent(String(req.params.id || ''), req.user.userId);
    if (!intent) return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
    if (intent.status === 'COMPLETED') return res.json(publicIntent(intent, { replayed: true }));
    if (intent.status !== 'OTP_PENDING') {
      return res.status(409).json({ error: 'Cette autorisation ne peut plus etre confirmee.', code: 'INTENT_NOT_PENDING', status: intent.status });
    }
    if (intent.otpExpiresAt <= new Date()) {
      await prisma.transactionIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
      return res.status(410).json({ error: 'Le code OTP a expire.', code: 'OTP_EXPIRED' });
    }
    if (intent.otpAttempts >= OTP_MAX_ATTEMPTS) {
      return res.status(423).json({ error: 'Autorisation verrouillee apres trop de tentatives.', code: 'OTP_LOCKED' });
    }
    if (payloadDigest(intent.payload) !== intent.payloadHash) {
      await prisma.transactionIntent.update({ where: { id: intent.id }, data: { status: 'FAILED', failureReason: 'Payload integrity failure' } });
      return res.status(409).json({ error: 'Integrite de la transaction invalide.', code: 'TRANSACTION_INTEGRITY_ERROR' });
    }

    const otp = String(req.body?.otp || '').trim();
    const candidate = Buffer.from(otpDigest(intent.id, intent.userId, intent.payloadHash, otp));
    const stored = Buffer.from(intent.otpHash);
    const valid = /^\d{8}$/.test(otp) && candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
    if (!valid) {
      const attempts = intent.otpAttempts + 1;
      await prisma.transactionIntent.update({
        where: { id: intent.id },
        data: { otpAttempts: attempts, ...(attempts >= OTP_MAX_ATTEMPTS ? { status: 'LOCKED' } : {}) },
      });
      return res.status(400).json({
        error: attempts >= OTP_MAX_ATTEMPTS ? 'Autorisation verrouillee.' : 'Code OTP invalide.',
        code: attempts >= OTP_MAX_ATTEMPTS ? 'OTP_LOCKED' : 'OTP_INVALID',
        attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
      });
    }

    const claimed = await prisma.transactionIntent.updateMany({
      where: { id: intent.id, userId: intent.userId, status: 'OTP_PENDING', otpAttempts: { lt: OTP_MAX_ATTEMPTS }, otpExpiresAt: { gt: new Date() } },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count !== 1) {
      const current = await prisma.transactionIntent.findUnique({ where: { id: intent.id } });
      if (current?.status === 'COMPLETED') return res.json(publicIntent(current, { replayed: true }));
      return res.status(409).json({ error: 'Autorisation deja en cours de traitement.', code: 'INTENT_ALREADY_PROCESSING' });
    }

    try {
      const result = await executeTransactionIntent(intent);
      const completed = await prisma.transactionIntent.update({
        where: { id: intent.id },
        data: { status: 'COMPLETED', result, consumedAt: new Date(), otpHash: crypto.randomBytes(32).toString('hex') },
      });
      return res.json(publicIntent(completed));
    } catch (executionError: any) {
      await prisma.transactionIntent.update({
        where: { id: intent.id },
        data: { status: 'FAILED', failureReason: String(executionError?.code || 'TRANSACTION_FAILED').slice(0, 120) },
      });
      throw executionError;
    }
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de confirmer la transaction.');
  }
};

export const resendTransactionOtp = async (req: any, res: Response) => {
  try {
    const intent = await getOwnedIntent(String(req.params.id || ''), req.user.userId);
    if (!intent) return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
    if (intent.status !== 'OTP_PENDING') return res.status(409).json({ error: 'Autorisation non renouvelable.', code: 'INTENT_NOT_PENDING' });
    if (intent.resendCount >= OTP_MAX_RESENDS) return res.status(429).json({ error: 'Nombre maximal de renvois atteint.', code: 'OTP_RESEND_LIMIT' });
    if (Date.now() - intent.lastOtpSentAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(429).json({ error: 'Veuillez patienter avant de demander un nouveau code.', code: 'OTP_RESEND_TOO_SOON' });
    }

    const user = await prisma.user.findUnique({ where: { id: intent.userId }, select: { phone: true, email: true } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.', code: 'USER_NOT_FOUND' });
    const otp = createOtp();
    const now = new Date();
    const delivery = await deliverTransactionOtp(user, otp, intent.summary);
    const updated = await prisma.transactionIntent.update({
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
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de renvoyer le code OTP.');
  }
};

export const cancelTransactionIntent = async (req: any, res: Response) => {
  try {
    const intent = await getOwnedIntent(String(req.params.id || ''), req.user.userId);
    if (!intent) return res.status(404).json({ error: 'Autorisation introuvable.', code: 'INTENT_NOT_FOUND' });
    const cancelled = await prisma.transactionIntent.updateMany({
      where: { id: intent.id, status: 'OTP_PENDING' },
      data: { status: 'CANCELLED', otpHash: crypto.randomBytes(32).toString('hex') },
    });
    if (cancelled.count !== 1) return res.status(409).json({ error: 'Cette autorisation ne peut plus etre annulee.', code: 'INTENT_NOT_PENDING' });
    return res.status(204).send();
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible d’annuler la transaction.');
  }
};
