import { Response } from 'express';
import prisma from '../utils/prisma';
import { sendErrorResponse } from '../utils/errorResponse';
import { getPushPublicKey } from '../services/pushService';
import { generateReceiptPdf } from '../services/receiptService';

const userIdFromRequest = (req: any) => String(req.user?.userId || req.user?.sub || '');
const validObjectId = (value: unknown) => /^[a-f\d]{24}$/i.test(String(value || ''));

export const getPushConfiguration = async (_req: any, res: Response) => {
  const publicKey = getPushPublicKey();
  if (!publicKey) return res.status(503).json({ error: 'Les notifications push ne sont pas configurees.', code: 'PUSH_NOT_CONFIGURED' });
  return res.json({ publicKey });
};

export const subscribePush = async (req: any, res: Response) => {
  try {
    const userId = userIdFromRequest(req);
    const endpoint = String(req.body?.endpoint || '').trim();
    const p256dh = String(req.body?.keys?.p256dh || '').trim();
    const auth = String(req.body?.keys?.auth || '').trim();
    if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2048 || !p256dh || !auth || p256dh.length > 256 || auth.length > 256) {
      return res.status(400).json({ error: 'Abonnement push invalide.', code: 'INVALID_PUSH_SUBSCRIPTION' });
    }
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh, auth, userAgent: String(req.get('User-Agent') || '').slice(0, 300), enabled: true },
      update: { userId, p256dh, auth, userAgent: String(req.get('User-Agent') || '').slice(0, 300), enabled: true },
    });
    await prisma.user.update({ where: { id: userId }, data: { pushNotifications: true } });
    return res.status(201).json({ id: subscription.id, enabled: subscription.enabled });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible d’activer les notifications push.');
  }
};

export const unsubscribePush = async (req: any, res: Response) => {
  try {
    const userId = userIdFromRequest(req);
    const endpoint = String(req.body?.endpoint || '').trim();
    if (endpoint) await prisma.pushSubscription.updateMany({ where: { userId, endpoint }, data: { enabled: false } });
    await prisma.user.update({ where: { id: userId }, data: { pushNotifications: false } });
    return res.status(204).send();
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de desactiver les notifications push.');
  }
};

export const listNotifications = async (req: any, res: Response) => {
  try {
    const userId = userIdFromRequest(req);
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return res.json({
      data: items.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        data: item.data,
        receiptId: item.receiptId,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
      total,
      unread,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de charger les notifications.');
  }
};

export const unreadNotificationCount = async (req: any, res: Response) => {
  try {
    const unread = await prisma.notification.count({ where: { userId: userIdFromRequest(req), readAt: null } });
    return res.json({ unread });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de charger le compteur de notifications.');
  }
};

export const markNotificationRead = async (req: any, res: Response) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(404).json({ error: 'Notification introuvable.' });
    const updated = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: userIdFromRequest(req) },
      data: { readAt: new Date() },
    });
    if (updated.count !== 1) return res.status(404).json({ error: 'Notification introuvable.' });
    return res.status(204).send();
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de marquer la notification comme lue.');
  }
};

export const markAllNotificationsRead = async (req: any, res: Response) => {
  try {
    await prisma.notification.updateMany({ where: { userId: userIdFromRequest(req), readAt: null }, data: { readAt: new Date() } });
    return res.status(204).send();
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de marquer les notifications comme lues.');
  }
};

export const downloadReceipt = async (req: any, res: Response) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(404).json({ error: 'Recu introuvable.' });
    const receipt = await prisma.receipt.findFirst({ where: { id: String(req.params.id), userId: userIdFromRequest(req) } });
    if (!receipt) return res.status(404).json({ error: 'Recu introuvable.' });
    const user = await prisma.user.findUnique({ where: { id: receipt.userId } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const pdf = await generateReceiptPdf(receipt, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.receiptNumber}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(pdf);
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de telecharger le recu.');
  }
};
