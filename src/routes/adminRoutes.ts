import { Router } from 'express';
import { 
  getUsers, 
  createUser,
  updateUserStatus, 
  getDashboardStats, 
  createCotisationGroup,
  getCotisations,
  getLoans,
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
  deleteTransferFee
} from '../controllers/adminController';
import { authMiddleware, adminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users', getUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUserStatus); // Existing but let's add a more general one or reuse
router.patch('/users/:id', updateUserStatus);
router.put('/users/:id/profile', updateUserProfile);
router.post('/users/:id/reset-password', resetUserPassword);
router.post('/users/:id/credit', creditUserAccount);
router.get('/stats', getDashboardStats);

// Legacy Tontine routes for backward compatibility
router.get('/tontines', getCotisations);
router.post('/tontines', createCotisationGroup);
router.put('/tontines/:id', updateCotisationGroup);
router.post('/tontines/participants', addParticipantToCotisation);
router.post('/tontines/remove-participant', removeParticipantFromCotisation);
router.post('/tontines/pay-caution', payCotisationFromCaution);
router.post('/tontines/pay-cash', payCotisationInCash);

// Cotisation routes
router.get('/cotisations', getCotisations);
router.post('/cotisations', createCotisationGroup);
router.post('/cotisations/participants', addParticipantToCotisation);
router.post('/cotisations/remove-participant', removeParticipantFromCotisation);
router.post('/cotisations/pay-caution', payCotisationFromCaution);
router.post('/cotisations/pay-cash', payCotisationInCash);

router.get('/loans', getLoans);
router.post('/loans', createLoan);
router.patch('/loans/:id', updateLoanStatus);
router.get('/transactions', getTransactions);
router.put('/transactions/:txId/validate', validateTransaction);
router.put('/transactions/:txId/reject', rejectTransaction);
router.get('/referral-stats', getReferralStats);

router.get('/groups', getGroups);
router.post('/groups', createGroup);
router.put('/groups/:id', updateGroup);
router.put('/users/:id/groups', assignUserGroups);
router.patch('/users/:id/kyc', updateUserKYC);
router.get('/currencies', getCurrencies);
router.post('/currencies/sync', syncCurrencies);
router.post('/transfer', adminTransfer);

router.get('/transfer-fees', getTransferFees);
router.post('/transfer-fees', createTransferFee);
router.put('/transfer-fees/:id', updateTransferFee);
router.delete('/transfer-fees/:id', deleteTransferFee);

router.get('/loan-configs', getLoanConfigs);
router.post('/loan-configs', createLoanConfig);
router.put('/loan-configs/:id', updateLoanConfig);
router.delete('/loan-configs/:id', deleteLoanConfig);

export default router;
