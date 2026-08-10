import prisma from '../utils/prisma';

let webpush: any = null;
try {
  webpush = require('web-push');
} catch {
  console.warn('[PushNotification] Module "web-push" non installé.');
}

// Base64URL VAPID Keys
const PUBLIC_VAPID_KEY = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMe9i34CchR0D26j_xU5x5w9u34CchR0D26j_xU5x5w9u34Cc';
const PRIVATE_VAPID_KEY = process.env.VAPID_PRIVATE_KEY || 'xU5x5w9u34CchR0D26j_xU5x5w9u34Cc_BEl62iUYgUi';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@nfs.cm';

if (webpush) {
  try {
    webpush.setVapidDetails(
      VAPID_SUBJECT,
      PUBLIC_VAPID_KEY,
      PRIVATE_VAPID_KEY
    );
  } catch (e: any) {
    console.warn('[PushNotification] VAPID configuration warning:', e?.message || e);
  }
}

export const getPublicVapidKey = () => PUBLIC_VAPID_KEY;

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, any>;
  tag?: string;
}

/**
 * Send web push notification to a user's registered devices using standard web-push ECE protocol
 */
export const sendPushToUser = async (userId: string, payload: PushPayload) => {
  if (!webpush) {
    return { success: 0, failed: 0 };
  }
  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId }
    });

    if (!subscriptions || subscriptions.length === 0) {
      return { success: 0, failed: 0 };
    }

    const payloadString = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-192x192.png',
      data: payload.data || {},
      tag: payload.tag || 'nfs-notification',
    });

    let success = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: sub.keys as { p256dh: string; auth: string },
        };

        await webpush.sendNotification(pushSubscription, payloadString);
        success++;
      } catch (err: any) {
        failed++;
        console.warn(`[PushNotification] Delivery failed for sub ${sub.id}:`, err?.message || err);
        // Remove expired / invalid subscriptions (404 / 410)
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        }
      }
    }

    return { success, failed };
  } catch (error: any) {
    console.error('[PushNotification] Error sending push to user:', error?.message || error);
    return { success: 0, failed: 0 };
  }
};
