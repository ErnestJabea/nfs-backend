import { Router } from 'express';
import { getWallets, transfer, transferPreview, getTransactions, lookupUserByAccountNumber } from '../controllers/walletController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getWallets);
router.post('/transfer', transfer);
router.post('/transfer-preview', transferPreview);
router.get('/lookup/:accountNumber', lookupUserByAccountNumber);
router.get('/transactions', getTransactions);

export default router;
