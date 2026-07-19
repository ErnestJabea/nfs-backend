import { Router } from 'express';
import { 
  getUsers, 
  createUser,
  updateUserStatus, 
  getDashboardStats, 
  createCotisationGroup,
  getCotisations,
  getCotisation,
  getLoans,
  getLoan,
  updateLoanStatus,
  getTransactions,
  getReferralStats,
  creditUserAccount,
  validateTransaction,
  rejectTransaction,
  getGroups,
  createGroup,
  updateGroup,
  updateCotisationGroup,
  assignUserGroups,
  updateUserKYC,
  updateUserProfile,
  resetUserPassword,
  getCurrencies,
  syncCurrencies,
  addParticipantToCotisation,
  removeParticipantFromCotisation,
  payCotisationFromCaution,
  payCotisationInCash,
  createLoan,
  getLoanConfigs,
  createLoanConfig,
  updateLoanConfig,
  deleteLoanConfig,
  adminTransfer,
  getTransferFees,
  createTransferFee,
  updateTransferFee,
  deleteTransferFee,
  getPermissionCatalog,
  getMyPermissions
} from '../controllers/adminController';
import { authMiddleware, adminMiddleware } from '../middlewares/authMiddleware';
import { requireAnyPermission, requirePermission } from '../middlewares/permissionMiddleware';
import prisma from '../utils/prisma';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

const requireUserViewPermission = (req: any, res: any, next: any) => {
  const role = String(req.query.role || '').toUpperCase();
  const permission = role === 'ADMIN' ? 'staff.view' : 'clients.view';
  return requirePermission(permission)(req, res, next);
};

const requireUserCreatePermission = (req: any, res: any, next: any) => {
  const role = String(req.body?.role || '').toUpperCase();
  const roles = Array.isArray(req.body?.roles) ? req.body.roles.map((item: any) => String(item).toUpperCase()) : [];
  const privilegedRoles = ['ADMIN', 'STAFF', 'COMEX'];
  const permission = privilegedRoles.includes(role) || roles.some((item: string) => privilegedRoles.includes(item)) ? 'staff.create' : 'clients.create';
  return requirePermission(permission)(req, res, next);
};

const requireLoanStatusPermission = (req: any, res: any, next: any) => {
  const status = String(req.body?.status || '').toUpperCase();
  const permission = status === 'REJECTED' ? 'loans.reject' : 'loans.validate';
  return requirePermission(permission)(req, res, next);
};

const targetUserIsStaff = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { roles: true } });
  return Boolean(user?.roles?.some(role => ['ADMIN', 'STAFF', 'COMEX'].includes(role)));
};

const requireUserMutationPermission = async (req: any, res: any, next: any) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role') || Object.prototype.hasOwnProperty.call(req.body || {}, 'roles')) {
      return requirePermission('groups.manage_permissions')(req, res, next);
    }
    const bodyKeys = Object.keys(req.body || {});
    const onlyActivation = bodyKeys.length > 0 && bodyKeys.every(key => ['activated', 'isActivated', 'isActive'].includes(key));
    const staff = await targetUserIsStaff(String(req.params.id));
    const permission = staff
      ? (onlyActivation ? 'staff.activate' : 'staff.update')
      : (onlyActivation ? 'clients.activate' : 'clients.update');
    return requirePermission(permission)(req, res, next);
  } catch {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
};

const requireUserProfilePermission = async (req: any, res: any, next: any) => {
  try {
    const permission = await targetUserIsStaff(String(req.params.id)) ? 'staff.update' : 'clients.update';
    return requirePermission(permission)(req, res, next);
  } catch {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }
};

router.get('/me/permissions', getMyPermissions);
router.get('/permissions/catalog', requirePermission('groups.view'), getPermissionCatalog);

router.get('/users', requireUserViewPermission, getUsers);
router.post('/users', requireUserCreatePermission, createUser);
router.put('/users/:id', requireUserMutationPermission, updateUserStatus);
router.patch('/users/:id', requireUserMutationPermission, updateUserStatus);
router.put('/users/:id/profile', requireUserProfilePermission, updateUserProfile);
router.post('/users/:id/reset-password', requirePermission('staff.reset_password'), resetUserPassword);
router.post('/users/:id/credit', requirePermission('clients.credit'), creditUserAccount);
router.get('/stats', requirePermission('dashboard.view'), getDashboardStats);

// Legacy Tontine routes for backward compatibility
router.get('/tontines', requirePermission('cotisations.view'), getCotisations);
router.get('/tontines/:id', requirePermission('cotisations.view'), getCotisation);
router.post('/tontines', requirePermission('cotisations.create'), createCotisationGroup);
router.put('/tontines/:id', requirePermission('cotisations.update'), updateCotisationGroup);
router.post('/tontines/participants', requirePermission('cotisations.manage_participants'), addParticipantToCotisation);
router.post('/tontines/remove-participant', requirePermission('cotisations.manage_participants'), removeParticipantFromCotisation);
router.post('/tontines/pay-caution', requirePermission('cotisations.pay'), payCotisationFromCaution);
router.post('/tontines/pay-cash', requirePermission('cotisations.pay'), payCotisationInCash);

// Cotisation routes
router.get('/cotisations', requirePermission('cotisations.view'), getCotisations);
router.get('/cotisations/:id', requirePermission('cotisations.view'), getCotisation);
router.post('/cotisations', requirePermission('cotisations.create'), createCotisationGroup);
router.post('/cotisations/participants', requirePermission('cotisations.manage_participants'), addParticipantToCotisation);
router.post('/cotisations/remove-participant', requirePermission('cotisations.manage_participants'), removeParticipantFromCotisation);
router.post('/cotisations/pay-caution', requirePermission('cotisations.pay'), payCotisationFromCaution);
router.post('/cotisations/pay-cash', requirePermission('cotisations.pay'), payCotisationInCash);

router.get('/loans', requirePermission('loans.view'), getLoans);
router.get('/loans/:id', requirePermission('loans.view'), getLoan);
router.post('/loans', requirePermission('loans.create'), createLoan);
router.patch('/loans/:id', requireLoanStatusPermission, updateLoanStatus);
router.get('/transactions', requireAnyPermission(['transactions.view', 'mobile_transactions.view']), getTransactions);
router.put('/transactions/:txId/validate', requirePermission('transactions.validate'), validateTransaction);
router.put('/transactions/:txId/reject', requirePermission('transactions.reject'), rejectTransaction);
router.get('/referral-stats', requirePermission('referral.view'), getReferralStats);

router.get('/groups', requirePermission('groups.view'), getGroups);
router.post('/groups', requirePermission('groups.create'), createGroup);
router.put('/groups/:id', requireAnyPermission(['groups.update', 'groups.manage_permissions']), updateGroup);
router.put('/users/:id/groups', requirePermission('groups.manage_permissions'), assignUserGroups);
router.patch('/users/:id/kyc', requirePermission('clients.kyc'), updateUserKYC);
router.get('/currencies', requirePermission('currencies.view'), getCurrencies);
router.post('/currencies/sync', requirePermission('currencies.sync'), syncCurrencies);
router.post('/transfer', requirePermission('transfers.create'), adminTransfer);

router.get('/transfer-fees', requirePermission('transfer_fees.view'), getTransferFees);
router.post('/transfer-fees', requirePermission('transfer_fees.create'), createTransferFee);
router.put('/transfer-fees/:id', requirePermission('transfer_fees.update'), updateTransferFee);
router.delete('/transfer-fees/:id', requirePermission('transfer_fees.delete'), deleteTransferFee);

router.get('/loan-configs', requirePermission('loans.configure'), getLoanConfigs);
router.post('/loan-configs', requirePermission('loans.configure'), createLoanConfig);
router.put('/loan-configs/:id', requirePermission('loans.configure'), updateLoanConfig);
router.delete('/loan-configs/:id', requirePermission('loans.configure'), deleteLoanConfig);

export default router;
