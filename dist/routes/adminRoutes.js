"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController_1 = require("../controllers/adminController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const permissionMiddleware_1 = require("../middlewares/permissionMiddleware");
const prisma_1 = __importDefault(require("../utils/prisma"));
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
router.use(authMiddleware_1.adminMiddleware);
const requireUserViewPermission = (req, res, next) => {
    const role = String(req.query.role || '').toUpperCase();
    const permission = role === 'ADMIN' ? 'staff.view' : 'clients.view';
    return (0, permissionMiddleware_1.requirePermission)(permission)(req, res, next);
};
const requireUserCreatePermission = (req, res, next) => {
    var _a, _b;
    const role = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.role) || '').toUpperCase();
    const roles = Array.isArray((_b = req.body) === null || _b === void 0 ? void 0 : _b.roles) ? req.body.roles.map((item) => String(item).toUpperCase()) : [];
    const privilegedRoles = ['ADMIN', 'STAFF', 'COMEX'];
    const permission = privilegedRoles.includes(role) || roles.some((item) => privilegedRoles.includes(item)) ? 'staff.create' : 'clients.create';
    return (0, permissionMiddleware_1.requirePermission)(permission)(req, res, next);
};
const requireLoanStatusPermission = (req, res, next) => {
    var _a;
    const status = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.status) || '').toUpperCase();
    const permission = status === 'REJECTED' ? 'loans.reject' : 'loans.validate';
    return (0, permissionMiddleware_1.requirePermission)(permission)(req, res, next);
};
const targetUserIsStaff = (id) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const user = yield prisma_1.default.user.findUnique({ where: { id }, select: { roles: true } });
    return Boolean((_a = user === null || user === void 0 ? void 0 : user.roles) === null || _a === void 0 ? void 0 : _a.some(role => ['ADMIN', 'STAFF', 'COMEX'].includes(role)));
});
const requireUserMutationPermission = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role') || Object.prototype.hasOwnProperty.call(req.body || {}, 'roles')) {
            return (0, permissionMiddleware_1.requirePermission)('groups.manage_permissions')(req, res, next);
        }
        const bodyKeys = Object.keys(req.body || {});
        const onlyActivation = bodyKeys.length > 0 && bodyKeys.every(key => ['activated', 'isActivated', 'isActive'].includes(key));
        const staff = yield targetUserIsStaff(String(req.params.id));
        const permission = staff
            ? (onlyActivation ? 'staff.activate' : 'staff.update')
            : (onlyActivation ? 'clients.activate' : 'clients.update');
        return (0, permissionMiddleware_1.requirePermission)(permission)(req, res, next);
    }
    catch (_a) {
        return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
});
const requireUserProfilePermission = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const permission = (yield targetUserIsStaff(String(req.params.id))) ? 'staff.update' : 'clients.update';
        return (0, permissionMiddleware_1.requirePermission)(permission)(req, res, next);
    }
    catch (_a) {
        return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
});
router.get('/me/permissions', adminController_1.getMyPermissions);
router.get('/permissions/catalog', (0, permissionMiddleware_1.requirePermission)('groups.view'), adminController_1.getPermissionCatalog);
router.get('/users', requireUserViewPermission, adminController_1.getUsers);
router.post('/users', requireUserCreatePermission, adminController_1.createUser);
router.put('/users/:id', requireUserMutationPermission, adminController_1.updateUserStatus);
router.patch('/users/:id', requireUserMutationPermission, adminController_1.updateUserStatus);
router.put('/users/:id/profile', requireUserProfilePermission, adminController_1.updateUserProfile);
router.post('/users/:id/reset-password', (0, permissionMiddleware_1.requirePermission)('staff.reset_password'), adminController_1.resetUserPassword);
router.post('/users/:id/credit', (0, permissionMiddleware_1.requirePermission)('clients.credit'), adminController_1.creditUserAccount);
router.get('/stats', (0, permissionMiddleware_1.requirePermission)('dashboard.view'), adminController_1.getDashboardStats);
// Legacy Tontine routes for backward compatibility
router.get('/tontines', (0, permissionMiddleware_1.requirePermission)('cotisations.view'), adminController_1.getCotisations);
router.get('/tontines/:id', (0, permissionMiddleware_1.requirePermission)('cotisations.view'), adminController_1.getCotisation);
router.post('/tontines', (0, permissionMiddleware_1.requirePermission)('cotisations.create'), adminController_1.createCotisationGroup);
router.put('/tontines/:id', (0, permissionMiddleware_1.requirePermission)('cotisations.update'), adminController_1.updateCotisationGroup);
router.post('/tontines/participants', (0, permissionMiddleware_1.requirePermission)('cotisations.manage_participants'), adminController_1.addParticipantToCotisation);
router.post('/tontines/remove-participant', (0, permissionMiddleware_1.requirePermission)('cotisations.manage_participants'), adminController_1.removeParticipantFromCotisation);
router.post('/tontines/pay-caution', (0, permissionMiddleware_1.requirePermission)('cotisations.pay'), adminController_1.payCotisationFromCaution);
router.post('/tontines/pay-cash', (0, permissionMiddleware_1.requirePermission)('cotisations.pay'), adminController_1.payCotisationInCash);
// Cotisation routes
router.get('/cotisations', (0, permissionMiddleware_1.requirePermission)('cotisations.view'), adminController_1.getCotisations);
router.get('/cotisations/:id', (0, permissionMiddleware_1.requirePermission)('cotisations.view'), adminController_1.getCotisation);
router.post('/cotisations', (0, permissionMiddleware_1.requirePermission)('cotisations.create'), adminController_1.createCotisationGroup);
router.post('/cotisations/participants', (0, permissionMiddleware_1.requirePermission)('cotisations.manage_participants'), adminController_1.addParticipantToCotisation);
router.post('/cotisations/remove-participant', (0, permissionMiddleware_1.requirePermission)('cotisations.manage_participants'), adminController_1.removeParticipantFromCotisation);
router.post('/cotisations/pay-caution', (0, permissionMiddleware_1.requirePermission)('cotisations.pay'), adminController_1.payCotisationFromCaution);
router.post('/cotisations/pay-cash', (0, permissionMiddleware_1.requirePermission)('cotisations.pay'), adminController_1.payCotisationInCash);
router.get('/loans', (0, permissionMiddleware_1.requirePermission)('loans.view'), adminController_1.getLoans);
router.get('/loans/:id', (0, permissionMiddleware_1.requirePermission)('loans.view'), adminController_1.getLoan);
router.post('/loans', (0, permissionMiddleware_1.requirePermission)('loans.create'), adminController_1.createLoan);
router.patch('/loans/:id', requireLoanStatusPermission, adminController_1.updateLoanStatus);
router.get('/transactions', (0, permissionMiddleware_1.requireAnyPermission)(['transactions.view', 'mobile_transactions.view']), adminController_1.getTransactions);
router.put('/transactions/:txId/validate', (0, permissionMiddleware_1.requirePermission)('transactions.validate'), adminController_1.validateTransaction);
router.put('/transactions/:txId/reject', (0, permissionMiddleware_1.requirePermission)('transactions.reject'), adminController_1.rejectTransaction);
router.get('/referral-stats', (0, permissionMiddleware_1.requirePermission)('referral.view'), adminController_1.getReferralStats);
router.get('/groups', (0, permissionMiddleware_1.requirePermission)('groups.view'), adminController_1.getGroups);
router.post('/groups', (0, permissionMiddleware_1.requirePermission)('groups.create'), adminController_1.createGroup);
router.put('/groups/:id', (0, permissionMiddleware_1.requireAnyPermission)(['groups.update', 'groups.manage_permissions']), adminController_1.updateGroup);
router.put('/users/:id/groups', (0, permissionMiddleware_1.requirePermission)('groups.manage_permissions'), adminController_1.assignUserGroups);
router.patch('/users/:id/kyc', (0, permissionMiddleware_1.requirePermission)('clients.kyc'), adminController_1.updateUserKYC);
router.get('/currencies', (0, permissionMiddleware_1.requirePermission)('currencies.view'), adminController_1.getCurrencies);
router.post('/currencies/sync', (0, permissionMiddleware_1.requirePermission)('currencies.sync'), adminController_1.syncCurrencies);
router.post('/transfer', (0, permissionMiddleware_1.requirePermission)('transfers.create'), adminController_1.adminTransfer);
router.get('/transfer-fees', (0, permissionMiddleware_1.requirePermission)('transfer_fees.view'), adminController_1.getTransferFees);
router.post('/transfer-fees', (0, permissionMiddleware_1.requirePermission)('transfer_fees.create'), adminController_1.createTransferFee);
router.put('/transfer-fees/:id', (0, permissionMiddleware_1.requirePermission)('transfer_fees.update'), adminController_1.updateTransferFee);
router.delete('/transfer-fees/:id', (0, permissionMiddleware_1.requirePermission)('transfer_fees.delete'), adminController_1.deleteTransferFee);
router.get('/loan-configs', (0, permissionMiddleware_1.requirePermission)('loans.configure'), adminController_1.getLoanConfigs);
router.post('/loan-configs', (0, permissionMiddleware_1.requirePermission)('loans.configure'), adminController_1.createLoanConfig);
router.put('/loan-configs/:id', (0, permissionMiddleware_1.requirePermission)('loans.configure'), adminController_1.updateLoanConfig);
router.delete('/loan-configs/:id', (0, permissionMiddleware_1.requirePermission)('loans.configure'), adminController_1.deleteLoanConfig);
exports.default = router;
