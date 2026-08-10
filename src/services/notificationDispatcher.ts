import prisma from '../utils/prisma';
import { sendPushToUser } from './pushNotificationService';
import { sendNotificationEmail } from './mailService';

export interface DispatchNotificationOptions {
  userId: string;
  type: 'SPONSORSHIP' | 'RECHARGE' | 'COTISATION' | 'CREDIT' | 'AVALISE' | 'TRANSFER' | 'SYSTEM';
  title: string;
  message: string;
  emailSubject?: string;
  emailHtml?: string;
  data?: Record<string, any>;
}

/**
 * Centralized Multi-Channel Dispatcher: In-App DB + Web Push + Email
 */
export const dispatchNotification = async (options: DispatchNotificationOptions) => {
  const { userId, type, title, message, emailSubject, emailHtml, data } = options;

  if (!userId) return null;

  try {
    // 1. Create In-App Notification record in Database
    const dbNotification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: data || {},
        read: false,
      }
    }).catch((err: any) => {
      console.error('[NotificationDispatcher] DB Error:', err);
      return null;
    });

    // 2. Fetch User details for Email & Push
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true, phone: true }
    });

    if (!user) return dbNotification;

    const recipientName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Cher membre';

    // 3. Dispatch Web Push Notification asynchronously
    sendPushToUser(userId, {
      title,
      body: message,
      data: {
        type,
        notificationId: dbNotification?.id,
        ...data,
      }
    }).catch((err: any) => console.error('[NotificationDispatcher] Push Error:', err));

    // 4. Dispatch Email Notification asynchronously
    if (user.email) {
      const subject = emailSubject || `NFS - ${title}`;
      const defaultHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; rounded: 10px;">
          <div style="background-color: #314BCE; padding: 15px; text-align: center; border-radius: 8px 8px 0 0;">
            <h2 style="color: #ffffff; margin: 0; font-size: 20px;">NFS Financial Solutions</h2>
          </div>
          <div style="padding: 20px; background-color: #ffffff;">
            <p style="font-size: 16px; color: #151940;">Bonjour <strong>${recipientName}</strong>,</p>
            <h3 style="color: #314BCE; font-size: 18px; margin-top: 15px;">${title}</h3>
            <p style="font-size: 14px; color: #555555; line-height: 1.6;">${message}</p>
            <div style="margin-top: 25px; padding: 15px; background-color: #f5f6fa; border-left: 4px solid #314BCE; border-radius: 4px;">
              <p style="margin: 0; font-size: 12px; color: #7f8192;">Pour consulter vos transactions et votre espace membre, connectez-vous sur votre application mobile NFS.</p>
            </div>
          </div>
          <div style="text-align: center; padding: 15px; font-size: 11px; color: #999999; border-top: 1px solid #eeeeee; margin-top: 20px;">
            &copy; ${new Date().getFullYear()} NFS Platform. Tous droits réservés.
          </div>
        </div>
      `;

      sendNotificationEmail(user.email, subject, emailHtml || defaultHtml).catch((err: any) => {
        console.error('[NotificationDispatcher] Email Error:', err);
      });
    }

    return dbNotification;
  } catch (error) {
    console.error('[NotificationDispatcher] Global Error:', error);
    return null;
  }
};
