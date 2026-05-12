import { Router } from 'express';
import { 
  getUsers, 
  createUser,
  updateUserStatus, 
  getDashboardStats, 
  createTontineGroup,
  getTontines,
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
  assignUserGroups,
  updateUserKYC,
  updateUserProfile,
  getCurrencies,
  syncCurrencies,
  addParticipantToTontine,
  removeParticipantFromTontine,
  payCotisationFromCaution,
  payCotisationInCash,
  createLoan,
  getLoanConfigs,
  createLoanConfig,
  updateLoanConfig,
  deleteLoanConfig
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
router.post('/users/:id/credit', creditUserAccount);
router.get('/stats', getDashboardStats);
router.get('/tontines', getTontines);
router.post('/tontines', createTontineGroup);
router.post('/tontines/participants', addParticipantToTontine);
router.post('/tontines/remove-participant', removeParticipantFromTontine);
router.post('/tontines/pay-caution', payCotisationFromCaution);
router.post('/tontines/pay-cash', payCotisationInCash);
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

router.get('/loan-configs', getLoanConfigs);
router.post('/loan-configs', createLoanConfig);
router.put('/loan-configs/:id', updateLoanConfig);
router.delete('/loan-configs/:id', deleteLoanConfig);

export default router;
