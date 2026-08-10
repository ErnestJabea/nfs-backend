import { Response } from 'express';
import prisma from '../utils/prisma';
import { getPublicVapidKey } from '../services/pushNotificationService';

export const getVapidKey = (_req: any, res: Response) => {
  return res.json({ publicKey: getPublicVapidKey() });
};

export const subscribePush = async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const { subscription, userAgent } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: "Données d'abonnement push invalides." });
    }

    const { endpoint, keys } = subscription;

    const pushSub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        keys,
        userAgent: userAgent || req.get('User-Agent') || 'PWA',
      },
      update: {
        userId,
        keys,
        userAgent: userAgent || req.get('User-Agent') || 'PWA',
        updatedAt: new Date(),
      }
    });

    return res.json({ message: 'Abonnement aux notifications Push enregistré avec succès.', data: pushSub });
  } catch (error: any) {
    console.error('subscribePush error:', error);
    return res.status(500).json({ error: 'Erreur lors de l’enregistrement Push.' });
  }
};

export const getNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json(notifications);
  } catch (error: any) {
    console.error('getNotifications error:', error);
    return res.status(500).json({ error: 'Erreur lors de la récupération des notifications.' });
  }
};

export const markNotificationRead = async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (id === 'read-all') {
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
    }

    await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });

    return res.json({ message: 'Notification marquée comme lue.' });
  } catch (error: any) {
    console.error('markNotificationRead error:', error);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
};
