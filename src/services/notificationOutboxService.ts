import prisma from '../utils/prisma';
import { generateReceiptPdf, receiptNumberForEvent, receiptPdfHash, verificationCodeForEvent } from './receiptService';
import { isSmtpConfigured, sendNotificationEmail } from './mailService';
import { getPushPublicKey, sendPush } from './pushService';

let processing = false;
let scheduled: NodeJS.Timeout | null = null;

const retryDelay = (attempts: number) => Math.min(15 * 60_000, Math.max(10_000, 2 ** attempts * 5_000));
const recipientName = (user: any) => `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Membre NFS';

const deliverPush = async (user: any, notification: any) => {
  if (!user.pushNotifications) return 'DISABLED';
  if (!getPushPublicKey()) return 'UNAVAILABLE';
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: user.id, enabled: true } });
  if (!subscriptions.length) return 'NO_SUBSCRIPTION';

  let delivered = 0;
  let transientError: any = null;
  for (const subscription of subscriptions) {
    try {
      await sendPush(subscription, {
        title: notification.title,
        body: user.balancePrivacy
          ? 'Une opération concernant votre compte a été confirmée.'
          : notification.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        tag: notification.eventId,
        data: { url: notification.data?.url || '/notifications', notificationId: notification.id },
      });
      delivered += 1;
      await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } });
    } catch (error: any) {
      if ([404, 410].includes(Number(error?.statusCode))) {
        await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { enabled: false } });
      } else {
        transientError = error;
      }
    }
  }
  if (!delivered && transientError) throw transientError;
  return delivered ? 'SENT' : 'NO_ACTIVE_SUBSCRIPTION';
};

const processEvent = async (event: any) => {
  const payload: any = event.payload || {};
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) throw new Error('Notification recipient not found.');

  let notification = await prisma.notification.upsert({
    where: { userId_eventId: { userId: user.id, eventId: event.eventKey } },
    create: {
      userId: user.id,
      eventId: event.eventKey,
      type: event.type,
      title: String(payload.title || 'Information NFS').slice(0, 140),
      body: String(payload.body || '').slice(0, 600),
      data: payload.data || {},
    },
    update: {},
  });

  let receipt: any = null;
  let receiptPdf: Buffer | undefined;
  if (payload.receipt) {
    receipt = await prisma.receipt.upsert({
      where: { userId_eventId: { userId: user.id, eventId: event.eventKey } },
      create: {
        userId: user.id,
        eventId: event.eventKey,
        transactionId: payload.receipt.transactionId || null,
        receiptNumber: receiptNumberForEvent(event.eventKey, event.createdAt),
        type: String(payload.receipt.type || event.type).slice(0, 80),
        title: String(payload.receipt.title || payload.title || 'Recu de transaction').slice(0, 160),
        snapshot: payload.receipt,
        verificationCode: verificationCodeForEvent(event.eventKey, user.id),
        createdAt: event.createdAt,
      },
      update: {},
    });
    receiptPdf = await generateReceiptPdf(receipt, user);
    const hash = receiptPdfHash(receiptPdf);
    if (receipt.pdfSha256 !== hash) receipt = await prisma.receipt.update({ where: { id: receipt.id }, data: { pdfSha256: hash } });
    notification = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        receiptId: receipt.id,
        data: { ...(notification.data as any || {}), receiptId: receipt.id, url: '/notifications' },
      },
    });
  }

  if (!notification.pushSentAt && !['DISABLED', 'UNAVAILABLE', 'NO_SUBSCRIPTION', 'NO_ACTIVE_SUBSCRIPTION'].includes(notification.pushStatus)) {
    const pushStatus = await deliverPush(user, notification);
    notification = await prisma.notification.update({
      where: { id: notification.id },
      data: { pushStatus, ...(pushStatus === 'SENT' ? { pushSentAt: new Date() } : {}) },
    });
  }

  const shouldEmail = Boolean(payload.mandatoryEmail || payload.receipt || user.emailNotifications);
  if (!shouldEmail || !user.email) {
    if (notification.emailStatus === 'PENDING') await prisma.notification.update({ where: { id: notification.id }, data: { emailStatus: !user.email ? 'NO_EMAIL' : 'DISABLED' } });
  } else if (!notification.emailSentAt) {
    if (!isSmtpConfigured()) {
      await prisma.notification.update({ where: { id: notification.id }, data: { emailStatus: 'UNAVAILABLE' } });
    } else {
      await sendNotificationEmail({
        to: user.email,
        subject: payload.title || 'Notification NFS',
        recipientName: recipientName(user),
        title: payload.title || 'Notification NFS',
        body: payload.body || '',
        receiptNumber: receipt?.receiptNumber,
        receiptPdf,
      });
      await prisma.notification.update({ where: { id: notification.id }, data: { emailStatus: 'SENT', emailSentAt: new Date() } });
    }
  }
};

export const processNotificationOutbox = async () => {
  if (processing) return;
  processing = true;
  try {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    await prisma.outboxEvent.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
      data: { status: 'RETRY', lockedAt: null, availableAt: new Date() },
    });
    const events = await prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'RETRY'] }, availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    for (const event of events) {
      const claimed = await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: { in: ['PENDING', 'RETRY'] } },
        data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      if (claimed.count !== 1) continue;
      try {
        await processEvent(event);
        await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'COMPLETED', processedAt: new Date(), lockedAt: null } });
      } catch (error: any) {
        const attempts = event.attempts + 1;
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: attempts >= 8 ? 'FAILED' : 'RETRY',
            lockedAt: null,
            availableAt: new Date(Date.now() + retryDelay(attempts)),
            lastError: String(error?.message || 'Notification delivery failed').slice(0, 300),
          },
        });
      }
    }
  } finally {
    processing = false;
  }
};

export const scheduleNotificationOutbox = () => {
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    processNotificationOutbox().catch(error => console.error('Notification outbox error:', error));
  }, 25);
  scheduled.unref?.();
};

export const startNotificationOutboxWorker = () => {
  scheduleNotificationOutbox();
  const timer = setInterval(() => processNotificationOutbox().catch(error => console.error('Notification outbox error:', error)), 10_000);
  timer.unref?.();
};
