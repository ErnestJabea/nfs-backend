import { Router } from 'express';
import { getVapidKey, subscribePush, getNotifications, markNotificationRead } from '../controllers/notificationController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/vapid-key', getVapidKey);
router.post('/subscribe', subscribePush);
router.get('/', getNotifications);
router.patch('/:id/read', markNotificationRead);

export default router;
