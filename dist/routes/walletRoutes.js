"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const walletController_1 = require("../controllers/walletController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
router.get('/', walletController_1.getWallets);
router.post('/transfer', (_req, res) => res.status(428).json({
    error: 'Le transfert direct est desactive. Creez puis confirmez une intention de transaction.',
    code: 'TRANSACTION_OTP_REQUIRED',
    intentEndpoint: '/api/transaction-intents',
}));
router.post('/transfer-preview', walletController_1.transferPreview);
router.get('/lookup/:accountNumber', walletController_1.lookupUserByAccountNumber);
router.get('/transactions', walletController_1.getTransactions);
exports.default = router;
