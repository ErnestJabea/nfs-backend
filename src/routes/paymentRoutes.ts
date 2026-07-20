import { Router } from 'express';
import { getPaymentProviders, getPaymentStatus, listPaymentsForAdministration } from '../controllers/paymentController';
import { adminMiddleware, authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/providers', getPaymentProviders);
router.get('/admin', adminMiddleware, listPaymentsForAdministration);
router.get('/:reference', getPaymentStatus);

export default router;
