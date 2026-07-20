import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { securityRateLimiter } from '../middlewares/rateLimiters';
import {
  downloadReceipt,
  getPushConfiguration,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribePush,
  unsubscribePush,
  unreadNotificationCount,
} from '../controllers/notificationController';

const router = Router();
router.use(authMiddleware);
router.get('/', listNotifications);
router.get('/unread-count', unreadNotificationCount);
router.get('/push/public-key', getPushConfiguration);
router.post('/push/subscriptions', securityRateLimiter, subscribePush);
router.delete('/push/subscriptions', securityRateLimiter, unsubscribePush);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);
router.get('/receipts/:id', downloadReceipt);

export default router;
