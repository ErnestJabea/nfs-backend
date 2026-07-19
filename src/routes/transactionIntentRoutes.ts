import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  transactionIntentRateLimiter,
  otpVerificationRateLimiter,
  otpResendRateLimiter,
} from '../middlewares/rateLimiters';
import {
  createTransactionIntent,
  confirmTransactionIntent,
  resendTransactionOtp,
  cancelTransactionIntent,
} from '../controllers/transactionIntentController';

const router = Router();

router.use(authMiddleware);
router.post('/', transactionIntentRateLimiter, createTransactionIntent);
router.post('/:id/confirm', otpVerificationRateLimiter, confirmTransactionIntent);
router.post('/:id/resend', otpResendRateLimiter, resendTransactionOtp);
router.post('/:id/cancel', cancelTransactionIntent);

export default router;
