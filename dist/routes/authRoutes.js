"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const compatibilityController_1 = require("../controllers/compatibilityController");
const transactionController_1 = require("../controllers/transactionController");
const epargneController_1 = require("../controllers/epargneController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const rateLimiters_1 = require("../middlewares/rateLimiters");
const authController_2 = require("../controllers/authController");
const router = (0, express_1.Router)();
const otpRequired = (_req, res) => res.status(428).json({
    error: 'Cette operation doit etre autorisee par un OTP transactionnel.',
    code: 'TRANSACTION_OTP_REQUIRED',
    intentEndpoint: '/api/transaction-intents',
});
router.get('/ping', (req, res) => {
    (0, authController_2.debugLog)("PING REQUEST RECEIVED");
    res.json({ status: "ok", time: new Date().toISOString(), message: "BACKEND REACHABLE" });
});
router.get('/mobile-dashboard', authMiddleware_1.authMiddleware, authController_1.getDashboardData);
router.post('/register', rateLimiters_1.authRateLimiter, authController_1.register);
router.post('/login', rateLimiters_1.authRateLimiter, authController_1.login);
router.post('/admin/login', rateLimiters_1.authRateLimiter, authController_1.adminLogin);
router.get('/session', authMiddleware_1.authMiddleware, authController_1.getSession);
router.post('/logout', authMiddleware_1.authMiddleware, authController_1.logout);
router.get('/profile', authMiddleware_1.authMiddleware, authController_1.getProfile);
router.patch('/profile', authMiddleware_1.authMiddleware, authController_1.updateProfile);
router.put('/profile', authMiddleware_1.authMiddleware, authController_1.updateProfile);
router.get('/countries', authController_1.getCountries);
router.get('/currencies', authMiddleware_1.authMiddleware, authController_1.getClientCurrencies);
router.get('/settings', authMiddleware_1.authMiddleware, authController_1.getUserSettings);
router.patch('/settings', authMiddleware_1.authMiddleware, authController_1.updateUserSettings);
router.get('/interest-summary', authMiddleware_1.authMiddleware, authController_1.getInterestSummary);
// Password Reset
router.post('/password-reset-code', rateLimiters_1.passwordResetRateLimiter, authController_1.requestPasswordReset);
router.post('/reset-password', rateLimiters_1.passwordResetRateLimiter, authController_1.resetPassword);
// Mobile Aliases
router.post('/sign_in', rateLimiters_1.authRateLimiter, authController_1.login);
router.post('/sign_up-new', rateLimiters_1.authRateLimiter, authController_1.register);
router.get('/activate-account/:id/:code', authController_1.activateAccount);
router.get('/users/principal-nfs', compatibilityController_1.getPrincipalNfs);
router.get('/users/:id', authMiddleware_1.authMiddleware, authController_1.getUserById);
router.get('/users/:id/avalise-capacity', authMiddleware_1.authMiddleware, authController_1.getAvaliseCapacity);
router.get('/cotisations-users/:idCotisation', authMiddleware_1.authMiddleware, compatibilityController_1.getCotisationUsers);
router.get('/cotisation-users/:idCotisation', authMiddleware_1.authMiddleware, compatibilityController_1.getCotisationUsers);
router.get('/assign-cotisation/:userId', authMiddleware_1.authMiddleware, otpRequired);
router.put('/update-user-infos-public/:userId', authMiddleware_1.authMiddleware, authController_1.updateUserInfo);
router.put('/update-user-infos/:userId', authMiddleware_1.authMiddleware, authController_1.updateUserInfo);
router.get('/cotisations', compatibilityController_1.getCotisations);
router.get('/providers/:code', authMiddleware_1.authMiddleware, compatibilityController_1.getProviderByCode);
// Transaction & Credit Compatibility
router.get('/userTransactions', authMiddleware_1.authMiddleware, transactionController_1.getUserTransactions);
router.get('/users/transactions/:userId', authMiddleware_1.authMiddleware, transactionController_1.getUserTransactions);
router.post('/transactions', authMiddleware_1.authMiddleware, otpRequired);
router.post('/transactions/:id', authMiddleware_1.authMiddleware, otpRequired);
router.get('/credits', transactionController_1.getCreditsPublic);
router.get('/credits/code/:code', authMiddleware_1.authMiddleware, transactionController_1.getCreditByCode);
router.get('/credits/:id', authMiddleware_1.authMiddleware, transactionController_1.getCreditById);
router.get('/credit-list-pending', authMiddleware_1.authMiddleware, transactionController_1.getCreditListPending);
router.get('/credit-list-eligible-for-avalise', authMiddleware_1.authMiddleware, transactionController_1.getEligibleCreditsForAvalise);
router.get('/credit-pending/:userId', authMiddleware_1.authMiddleware, transactionController_1.getCumulCredit);
router.get('/credit-success/:userId', authMiddleware_1.authMiddleware, transactionController_1.getCumulCredit);
router.get('/transaction/generate-invoice/:id', authMiddleware_1.authMiddleware, transactionController_1.generateInvoice);
// Epargne (Savings) Workflows
router.post('/epargne/request', authMiddleware_1.authMiddleware, otpRequired);
router.post('/epargne/direct', authMiddleware_1.authMiddleware, otpRequired);
router.post('/epargne/validate/:transactionId', authMiddleware_1.authMiddleware, epargneController_1.validateEpargne);
exports.default = router;
