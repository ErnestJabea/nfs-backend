import { Router } from 'express';
import { getWallets, transfer, transferPreview, getTransactions, lookupUserByAccountNumber } from '../controllers/walletController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getWallets);
router.post('/transfer', (_req, res) => res.status(428).json({
  error: 'Le transfert direct est desactive. Creez puis confirmez une intention de transaction.',
  code: 'TRANSACTION_OTP_REQUIRED',
  intentEndpoint: '/api/transaction-intents',
}));
router.post('/transfer-preview', transferPreview);
router.get('/lookup/:accountNumber', lookupUserByAccountNumber);
router.get('/transactions', getTransactions);

export default router;
