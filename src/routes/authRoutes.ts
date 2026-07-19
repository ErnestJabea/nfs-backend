import { Router } from 'express';
import { register, login, adminLogin, getProfile, getClientCurrencies, getSession, logout, requestPasswordReset, resetPassword, activateAccount, updateUserInfo, getAvaliseCapacity, getDashboardData, getUserById } from '../controllers/authController';

import { getCotisations, getProviderByCode, getPrincipalNfs, getCotisationUsers, assignCotisation } from '../controllers/compatibilityController';
import { getUserTransactions, getCreditListPending, getCumulCredit, generateInvoice, createTransaction, getCreditsPublic, avaliseTransaction, getCreditById, getCreditByCode } from '../controllers/transactionController';
import { requestEpargne, validateEpargne, directEpargne } from '../controllers/epargneController';


import { authMiddleware } from '../middlewares/authMiddleware';
import { authRateLimiter, passwordResetRateLimiter } from '../middlewares/rateLimiters';

import { debugLog } from '../controllers/authController';

const router = Router();
const otpRequired = (_req: any, res: any) => res.status(428).json({
  error: 'Cette operation doit etre autorisee par un OTP transactionnel.',
  code: 'TRANSACTION_OTP_REQUIRED',
  intentEndpoint: '/api/transaction-intents',
});

router.get('/ping', (req, res) => {
  debugLog("PING REQUEST RECEIVED");
  res.json({ status: "ok", time: new Date().toISOString(), message: "BACKEND REACHABLE" });
});

router.get('/mobile-dashboard', authMiddleware, getDashboardData);
router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.post('/admin/login', authRateLimiter, adminLogin);
router.get('/session', authMiddleware, getSession);
router.post('/logout', authMiddleware, logout);
router.get('/profile', authMiddleware, getProfile);
router.get('/currencies', authMiddleware, getClientCurrencies);


// Password Reset
router.post('/password-reset-code', passwordResetRateLimiter, requestPasswordReset);
router.post('/reset-password', passwordResetRateLimiter, resetPassword);

// Mobile Aliases
router.post('/sign_in', authRateLimiter, login);
router.post('/sign_up-new', authRateLimiter, register);
router.get('/activate-account/:id/:code', activateAccount);
router.get('/users/principal-nfs', getPrincipalNfs);
router.get('/users/:id', authMiddleware, getUserById);
router.get('/users/:id/avalise-capacity', authMiddleware, getAvaliseCapacity);
router.get('/cotisations-users/:idCotisation', authMiddleware, getCotisationUsers);
router.get('/cotisation-users/:idCotisation', authMiddleware, getCotisationUsers);
router.get('/assign-cotisation/:userId', authMiddleware, otpRequired);

router.put('/update-user-infos-public/:userId', authMiddleware, updateUserInfo);
router.put('/update-user-infos/:userId', authMiddleware, updateUserInfo);

router.get('/cotisations', getCotisations);
router.get('/providers/:code', authMiddleware, getProviderByCode);

// Transaction & Credit Compatibility
router.get('/userTransactions', authMiddleware, getUserTransactions);
router.get('/users/transactions/:userId', authMiddleware, getUserTransactions);
router.post('/transactions', authMiddleware, otpRequired);
router.post('/transactions/:id', authMiddleware, otpRequired);
router.get('/credits', getCreditsPublic);
router.get('/credits/code/:code', authMiddleware, getCreditByCode);
router.get('/credits/:id', authMiddleware, getCreditById);
router.get('/credit-list-pending', authMiddleware, getCreditListPending);
router.get('/credit-pending/:userId', authMiddleware, getCumulCredit);
router.get('/credit-success/:userId', authMiddleware, getCumulCredit);
router.get('/transaction/generate-invoice/:id', authMiddleware, generateInvoice);

// Epargne (Savings) Workflows
router.post('/epargne/request', authMiddleware, otpRequired);
router.post('/epargne/direct', authMiddleware, otpRequired);
router.post('/epargne/validate/:transactionId', authMiddleware, validateEpargne);





export default router;
