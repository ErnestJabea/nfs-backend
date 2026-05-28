import { Router } from 'express';
import { register, login, adminLogin, getProfile, requestPasswordReset, resetPassword, activateAccount, updateUserInfo, getAvaliseCapacity, getDashboardData, getUserById } from '../controllers/authController';

import { getCotisations, getProviderByCode, getPrincipalNfs, getCotisationUsers, assignCotisation } from '../controllers/compatibilityController';
import { getUserTransactions, getCreditListPending, getCumulCredit, generateInvoice, createTransaction, getCreditsPublic, avaliseTransaction, getCreditById, getCreditByCode } from '../controllers/transactionController';
import { requestEpargne, validateEpargne, directEpargne } from '../controllers/epargneController';


import { authMiddleware } from '../middlewares/authMiddleware';

import { debugLog } from '../controllers/authController';

const router = Router();

router.get('/ping', (req, res) => {
  debugLog("PING REQUEST RECEIVED");
  res.json({ status: "ok", time: new Date().toISOString(), message: "BACKEND REACHABLE" });
});

router.get('/mobile-dashboard', authMiddleware, getDashboardData);
router.post('/register', register);
router.post('/login', login);
router.post('/admin/login', adminLogin);
router.get('/profile', authMiddleware, getProfile);


// Password Reset
router.get('/password-reset-code', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Mobile Aliases
router.post('/sign_in', login);
router.post('/sign_up-new', register);
router.get('/activate-account/:id/:code', activateAccount);
router.get('/users/principal-nfs', getPrincipalNfs);
router.get('/users/:id', authMiddleware, getUserById);
router.get('/users/:id/avalise-capacity', authMiddleware, getAvaliseCapacity);
router.get('/cotisations-users/:idCotisation', authMiddleware, getCotisationUsers);
router.get('/cotisation-users/:idCotisation', authMiddleware, getCotisationUsers);
router.get('/assign-cotisation/:userId', authMiddleware, assignCotisation);

router.put('/update-user-infos-public/:userId', updateUserInfo);
router.put('/update-user-infos/:userId', authMiddleware, updateUserInfo);

router.get('/cotisations', getCotisations);
router.get('/providers/:code', authMiddleware, getProviderByCode);

// Transaction & Credit Compatibility
router.get('/userTransactions', authMiddleware, getUserTransactions);
router.get('/users/transactions/:userId', authMiddleware, getUserTransactions);
router.post('/transactions', authMiddleware, createTransaction);
router.post('/transactions/:id', authMiddleware, avaliseTransaction);
router.get('/credits', getCreditsPublic);
router.get('/credits/code/:code', authMiddleware, getCreditByCode);
router.get('/credits/:id', authMiddleware, getCreditById);
router.get('/credit-list-pending', authMiddleware, getCreditListPending);
router.get('/credit-pending/:userId', authMiddleware, getCumulCredit);
router.get('/credit-success/:userId', authMiddleware, getCumulCredit);
router.get('/transaction/generate-invoice/:id', authMiddleware, generateInvoice);

// Epargne (Savings) Workflows
router.post('/epargne/request', authMiddleware, requestEpargne);
router.post('/epargne/direct', authMiddleware, directEpargne);
router.post('/epargne/validate/:transactionId', authMiddleware, validateEpargne);





export default router;
