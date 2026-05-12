import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { updateExchangeRates } from '../services/currencyService';
import { sendWelcomeEmail } from '../utils/mailer';
import { computeAvalise } from '../utils/computeAvalise';

export const getUsers = async (req: Request, res: Response) => {
  try {
    const roleParam = req.query.role;
    const role = typeof roleParam === 'string' ? roleParam : undefined;
    
    const users = await prisma.user.findMany({
      where: role ? { roles: { has: role } } : {},
      orderBy: { createdAt: 'desc' }
    });

    const allAccountIds = users.flatMap(u => u.accountIds || []);
    const accounts = await prisma.account.findMany({
      where: { id: { in: allAccountIds } }
    });

    const mappedUsers = users.map(user => {
      const userAccounts = accounts.filter(a => (user.accountIds || []).includes(a.id));
      const computedAccounts = computeAvalise(userAccounts);
      return {
        ...user,
        accounts: computedAccounts
      };
    });

    res.json(mappedUsers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, phone, email, role, country, referrerName, address, addressImageUrl } = req.body;
    
    const generatePassword = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let password = '';
      for (let i = 0; i < 6; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
      return password;
    };
    
    const plainPassword = generatePassword();
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
    const createdAccounts = await Promise.all(defaultAccountTypes.map(type => 
      prisma.account.create({
        data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' }
      })
    ));

    const accountIds = createdAccounts.map(a => a.id);

    const newUser = await prisma.user.create({
      data: {
        firstName, lastName, phone, email: email && email.trim() !== '' ? email.trim() : null,
        password: hashedPassword, roles: [role || "CLIENT"], activated: true, verified: false,
        country: country || "Cameroun", referrerName, address, addressImageUrl, accountIds
      }
    });

    if (email && email.trim() !== '') {
      try { await sendWelcomeEmail(email, firstName || 'Client', plainPassword); } catch (e) {}
    }

    res.status(201).json(newUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActivated, kycStatus } = req.body;
    const user = await prisma.user.update({
      where: { id: id as string },
      data: { activated: isActivated, verified: kycStatus === 'VERIFIED' }
    });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const updatedUser = await prisma.user.update({
      where: { id: id as string },
      data: {
        ...data,
        joiningYear: data.joiningYear ? parseInt(data.joiningYear) : undefined,
        averageIncome: data.averageIncome ? parseFloat(data.averageIncome) : undefined
      }
    });
    res.json(updatedUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const creditUserAccount = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, description, accountType = 'PRINCIPAL', sourceAccountType, currency = 'XAF' } = req.body;
    const adminUser = req.user ? await prisma.user.findUnique({ where: { id: req.user.userId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';

    const transaction = await prisma.transaction.create({
      data: {
        userId: id as string, purpose: description || `DÉPÔT ${accountType}`, amount, currency,
        status: 'PENDING', transactionRef: `NFS-${Date.now()}`, createdBy: adminName,
        sourceAccountType: sourceAccountType || null, targetAccountType: accountType
      }
    });
    res.json({ message: "Opération soumise au COMEX", transaction });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const validateTransaction = async (req: any, res: Response) => {
  try {
    const { txId } = req.params;
    const adminUser = req.user ? await prisma.user.findUnique({ where: { id: req.user.userId } }) : null;
    const adminName = `${adminUser?.firstName} ${adminUser?.lastName}`;
    const tx = await prisma.transaction.findUnique({ where: { id: txId } });
    
    if (!tx || tx.status !== 'PENDING') return res.status(400).json({ error: "Transaction invalide." });
    
    // Vérifier les droits COMEX/ADMIN
    const isAuthorized = adminUser?.roles.includes('COMEX') || adminUser?.roles.includes('ADMIN');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Seul un membre du COMEX peut valider une transaction." });
    }

    // Empêcher l'auto-validation
    if (tx.createdBy === adminName) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez vous-même initiée." });
    }

    if (tx.validatedBy.includes(adminName)) return res.status(400).json({ error: "Vous avez déjà validé cette transaction." });

    const newValidators = [...tx.validatedBy, adminName];

    if (newValidators.length >= 3) {
      const user = await prisma.user.findUnique({ where: { id: tx.userId! } });
      const accounts = await prisma.account.findMany({ where: { id: { in: user!.accountIds } } });
      let targetAccount = accounts.find(a => a.type === tx.targetAccountType);
      
      await prisma.account.update({
        where: { id: targetAccount!.id },
        data: { currentBalance: { increment: tx.amount! }, availableBalance: { increment: tx.amount! } }
      });

      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: 'SUCCESS', validatedBy: newValidators }
      });
      res.json({ message: "Validé (3/3)" });
    } else {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { validatedBy: newValidators }
      });
      res.json({ message: `Validé (${newValidators.length}/3)` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const rejectTransaction = async (req: any, res: Response) => {
  try {
    const { txId } = req.params;
    const tx = await prisma.transaction.update({
      where: { id: txId },
      data: { status: 'REJECTED' }
    });
    res.json(tx);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const userCount = await prisma.user.count();
    const transactionCount = await prisma.transaction.count();
    const pendingLoans = await prisma.loan.count({ where: { status: 'PENDING' } });
    // Calcul des volumes par type de compte
    const allAccounts = await prisma.account.findMany();
    
    const volumePrincipal = allAccounts
      .filter(a => a.type === 'PRINCIPAL')
      .reduce((sum, a) => sum + (a.currentBalance || 0), 0);
      
    const volumeEpargne = allAccounts
      .filter(a => a.type === 'EPARGNE')
      .reduce((sum, a) => sum + (a.currentBalance || 0), 0);
      
    const volumeCaution = allAccounts
      .filter(a => a.type === 'CAUTION')
      .reduce((sum, a) => sum + (a.currentBalance || 0), 0);
      
    const volumeTontine = allAccounts
      .filter(a => a.type === 'DJANGUI_NON_PERCU' || a.type === 'DJANGUI_PERCU')
      .reduce((sum, a) => sum + (a.currentBalance || 0), 0);

    const totalAssets = volumePrincipal + volumeEpargne + volumeCaution + volumeTontine;

    // Calcul de la capacité d'avalise totale du système
    const computedAccounts = computeAvalise(allAccounts);
    const totalAvaliseCapacity = computedAccounts
      .filter(a => a.type === 'AVALISE')
      .reduce((sum, a) => sum + (a.availableBalance || 0), 0);

    const activeTontines = await prisma.tontineGroup.count({ where: { status: 'ACTIF' } });

    res.json({ 
      userCount, 
      volumePrincipal,
      volumeEpargne,
      volumeCaution,
      volumeTontine,
      totalAssets,
      transactionCount, 
      pendingLoans,
      totalAvaliseCapacity,
      activeTontines
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createTontineGroup = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const group = await prisma.tontineGroup.create({ data: { ...data, status: 'ACTIF' } });
    res.status(201).json(group);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTontines = async (req: Request, res: Response) => {
  try {
    const groups = await prisma.tontineGroup.findMany({ include: { members: true } });
    res.json(groups);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const addParticipantToTontine = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    const updated = await prisma.tontineGroup.update({
      where: { id: groupId },
      data: { members: { connect: { id: userId } } },
      include: { members: true }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const removeParticipantFromTontine = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    const updated = await prisma.tontineGroup.update({
      where: { id: groupId },
      data: { members: { disconnect: { id: userId } } },
      include: { members: true }
    });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const payCotisationFromCaution = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    res.json({ message: "Payé via Caution" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const payCotisationInCash = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    res.json({ message: "Payé en espèces" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getLoans = async (req: Request, res: Response) => {
  try {
    const loans = await prisma.loan.findMany({ include: { user: true }, orderBy: { createdAt: 'desc' } });
    res.json(loans);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateLoanStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const adminUser = req.user ? await prisma.user.findUnique({ where: { id: req.user.userId } }) : null;
    if (!adminUser) return res.status(401).json({ error: "Non authentifié" });

    // Vérifier les droits COMEX/ADMIN
    const isAuthorized = adminUser.roles.includes('COMEX') || adminUser.roles.includes('ADMIN');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Seul un membre du COMEX peut valider un crédit." });
    }

    const loan = await prisma.loan.findUnique({ where: { id: id as string } });
    if (!loan) return res.status(404).json({ error: "Prêt non trouvé" });

    // Règle de séparation des tâches : Ne pas valider son propre prêt
    const adminName = `${adminUser.firstName} ${adminUser.lastName}`;
    if (status === 'APPROVED' && loan.createdBy === adminName) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider un crédit que vous avez vous-même saisi." });
    }

    const updatedLoan = await prisma.loan.update({
      where: { id: id as string },
      data: { 
        status: status as string,
        validatedBy: status === 'APPROVED' ? adminName : undefined
      },
      include: { user: true }
    });
    res.json(updatedLoan);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createLoan = async (req: any, res: Response) => {
  try {
    const { userId, amount, duration, purpose, avalistes, interestRate } = req.body;
    
    // Identifier le créateur
    const adminUser = req.user ? await prisma.user.findUnique({ where: { id: req.user.userId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';

    const loan = await prisma.loan.create({
      data: {
        userId, amount: parseFloat(amount), duration: parseInt(duration),
        interestRate: parseFloat(interestRate), totalInterest: (parseFloat(amount) * (parseFloat(interestRate) / 100)),
        purpose, status: 'PENDING', 
        avalistes: Array.isArray(avalistes) ? avalistes : [],
        createdBy: adminName
      },
      include: { user: true }
    });
    res.status(201).json(loan);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const transactions = await prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, include: { user: true } });
    res.json(transactions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getReferralStats = async (req: Request, res: Response) => {
  try { res.json([]); } catch (error: any) { res.status(500).json({ error: error.message }); }
};

export const getGroups = async (req: Request, res: Response) => {
  try {
    const groups = await prisma.userGroup.findMany({ include: { users: true } });
    res.json(groups);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const createGroup = async (req: Request, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    const group = await prisma.userGroup.create({ data: { name, description, permissions } });
    res.json(group);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const updateGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const group = await prisma.userGroup.update({ where: { id: id as string }, data });
    res.json(group);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const assignUserGroups = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { groupIds, roles } = req.body;
    const user = await prisma.user.update({
      where: { id: id as string },
      data: { roles, userGroups: { set: groupIds.map((id: string) => ({ id })) } }
    });
    res.json(user);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const getCurrencies = async (req: Request, res: Response) => {
  try {
    const currencies = await prisma.currency.findMany({ where: { isActive: true } });
    res.json(currencies);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const syncCurrencies = async (req: Request, res: Response) => {
  try { await updateExchangeRates(); res.json({ message: "OK" }); } catch (e: any) { res.status(500).json({ error: e.message }); }
};

export const getLoanConfigs = async (req: Request, res: Response) => {
  try {
    const configs = await prisma.loanConfig.findMany({ orderBy: { code: 'asc' } });
    res.json(configs);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
};

export const createLoanConfig = async (req: Request, res: Response) => {
  try {
    const { code, rate, duration } = req.body;
    
    // Vérifier si le code existe déjà
    const existing = await prisma.loanConfig.findUnique({ where: { code } });
    if (existing) {
      return res.status(400).json({ error: `Le code crédit "${code}" existe déjà.` });
    }

    const config = await prisma.loanConfig.create({
      data: { code, rate: parseFloat(rate), duration: parseInt(duration) }
    });
    res.status(201).json(config);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
};

export const updateLoanConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { code, rate, duration } = req.body;
    const config = await prisma.loanConfig.update({
      where: { id: id as string },
      data: { code, rate: parseFloat(rate), duration: parseInt(duration) }
    });
    res.json(config);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
};

export const deleteLoanConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.loanConfig.delete({ where: { id: id as string } });
    res.json({ message: 'Configuration supprimée' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
};

export const updateUserKYC = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const user = await prisma.user.update({
      where: { id: id as string },
      data: {
        ...data,
        averageIncome: data.averageIncome ? parseFloat(data.averageIncome) : undefined,
        verified: data.kycStatus === 'APPROVED'
      }
    });
    res.json(user);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
};