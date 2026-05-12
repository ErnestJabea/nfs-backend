import { Router } from 'express';
import { getWallets, transfer, getTransactions } from '../controllers/walletController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getWallets);
router.post('/transfer', transfer);
router.get('/transactions', getTransactions);

export default router;
