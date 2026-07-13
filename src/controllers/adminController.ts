import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { updateExchangeRates } from '../services/currencyService';
import { sendPasswordResetEmail, sendWelcomeEmail } from '../utils/mailer';
import { computeAvalise } from '../utils/computeAvalise';
import { normalizePermissions, permissionCatalog } from '../security/permissions';
import { getEffectivePermissions } from '../middlewares/permissionMiddleware';

const parseRoles = (body: any): string[] | undefined => {
  const r = body.roles || body.role;
  if (!r) return undefined;
  const roles = Array.isArray(r) ? r : [r];
  const normalizedRoles = roles
    .filter((role: any) => typeof role === 'string' && role.trim() !== '')
    .map((role: string) => role.trim().toUpperCase());
  return normalizedRoles.length > 0 ? normalizedRoles : undefined;
};

const hasOwn = (body: any, key: string) => Object.prototype.hasOwnProperty.call(body, key);

const normalizeText = (value: any): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeEmail = (value: any): string | null | undefined => {
  if (value === undefined) return undefined;
  const trimmed = normalizeText(value);
  return trimmed ? trimmed.toLowerCase() : null;
};

const generateTemporaryPassword = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  return Array.from({ length: 14 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
};

const generatePublicCode = (prefix: string, byteLength = 6): string => {
  return `${prefix}-${crypto.randomBytes(byteLength).toString('hex').toUpperCase()}`;
};

const uniqueConflictMessage = (error: any): string | undefined => {
  if (error?.code !== 'P2002') return undefined;
  const target = Array.isArray(error?.meta?.target) ? error.meta.target.join(',') : String(error?.meta?.target || '');
  if (target.includes('email')) return 'Cet email est deja utilise.';
  if (target.includes('phone')) return 'Ce numero de telephone est deja utilise.';
  if (target.includes('accountNumber')) return 'Ce numero de compte existe deja. Veuillez reessayer.';
  if (target.includes('uniqueKey')) return 'Cette cle unique existe deja. Veuillez reessayer.';
  return 'Une valeur unique existe deja.';
};

const findUserUniquenessConflict = async (
  fields: { email?: string | null; phone?: string },
  currentUserId?: string
): Promise<string | undefined> => {
  if (fields.email) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: fields.email },
      select: { id: true }
    });
    if (existingByEmail && existingByEmail.id !== currentUserId) {
      return 'Cet email est deja utilise.';
    }
  }

  if (fields.phone) {
    const existingByPhone = await prisma.user.findUnique({
      where: { phone: fields.phone },
      select: { id: true }
    });
    if (existingByPhone && existingByPhone.id !== currentUserId) {
      return 'Ce numero de telephone est deja utilise.';
    }
  }

  return undefined;
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const roleParam = req.query.role;
    const role = typeof roleParam === 'string' ? roleParam : undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 0;
    
    const whereClause = role ? { roles: { has: role } } : {};

    let users;
    let total = 0;

    if (limit > 0) {
      const skip = (page - 1) * limit;
      const [fetchedUsers, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { userGroups: true }
        }),
        prisma.user.count({ where: whereClause })
      ]);
      users = fetchedUsers;
      total = totalCount;
    } else {
      users = await prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        include: { userGroups: true }
      });
    }

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

    if (limit > 0) {
      return res.json({ data: mappedUsers, total, page, totalPages: Math.ceil(total / limit) });
    }

    res.json(mappedUsers);
  } catch (error: any) {
    console.error('getUsers error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const createUser = async (req: Request, res: Response) => {
  let createdAccountIds: string[] = [];

  try {
    const { firstName, lastName, phone, email, country, referrerName, address, addressImageUrl } = req.body;
    const normalizedPhone = normalizeText(phone);
    const normalizedEmail = normalizeEmail(email) || null;
    const roles = parseRoles(req.body) || ["CLIENT"];

    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
    }

    if (roles.includes('ADMIN') && !normalizedEmail) {
      return res.status(400).json({ error: 'L email est obligatoire pour creer un administrateur.' });
    }

    const uniquenessConflict = await findUserUniquenessConflict({
      email: normalizedEmail,
      phone: normalizedPhone
    });

    if (uniquenessConflict) {
      return res.status(409).json({ error: uniquenessConflict });
    }
    
    const plainPassword = generateTemporaryPassword();
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
    const createdAccounts = await Promise.all(defaultAccountTypes.map(type => 
      prisma.account.create({
        data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' }
      })
    ));

    const accountIds = createdAccounts.map(a => a.id);
    createdAccountIds = accountIds;
    const accountNumber = generatePublicCode('NFS');
    const uniqueKey = generatePublicCode('KEY', 8);

    const newUser = await prisma.user.create({
      data: {
        firstName, lastName, phone: normalizedPhone, ...(normalizedEmail ? { email: normalizedEmail } : {}),
        password: hashedPassword, roles: roles, activated: true, verified: false,
        country: country || "Cameroun", referrerName, address, addressImageUrl, accountIds,
        accountNumber, uniqueKey
      }
    });

    if (email && email.trim() !== '') {
      try { await sendWelcomeEmail(email, firstName || 'Client', plainPassword); } catch (e) {}
    }

    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('createUser error:', error);
    if (createdAccountIds.length > 0) {
      try {
        await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
      } catch (cleanupError) {
        console.error('createUser cleanup error:', cleanupError);
      }
    }

    const conflictMessage = uniqueConflictMessage(error);
    if (conflictMessage) {
      return res.status(409).json({ error: conflictMessage });
    }

    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const data: any = {};

    if (hasOwn(body, 'isActivated')) data.activated = Boolean(body.isActivated);
    if (hasOwn(body, 'activated')) data.activated = Boolean(body.activated);
    if (hasOwn(body, 'isActive')) data.activated = Boolean(body.isActive);

    if (hasOwn(body, 'kycStatus')) {
      const kycStatus = String(body.kycStatus || '').toUpperCase();
      data.kycStatus = kycStatus;
      data.verified = ['VERIFIED', 'APPROVED'].includes(kycStatus);
    }

    if (hasOwn(body, 'verified')) data.verified = Boolean(body.verified);

    const editableFields = [
      'firstName', 'lastName', 'country', 'referrerName', 'address', 'addressImageUrl',
      'profession', 'matricule', 'service', 'documentType', 'documentNumber',
      'documentUrl', 'ribUrl', 'swiftCode'
    ];

    editableFields.forEach(field => {
      if (hasOwn(body, field)) data[field] = body[field];
    });

    if (hasOwn(body, 'email')) {
      data.email = normalizeEmail(body.email);
    }

    if (hasOwn(body, 'phone')) {
      const normalizedPhone = normalizeText(body.phone);
      if (!normalizedPhone) return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
      data.phone = normalizedPhone;
    }

    const parsedRoles = parseRoles(body);
    if (parsedRoles) data.roles = parsedRoles;

    if (hasOwn(body, 'joiningYear')) {
      data.joiningYear = body.joiningYear ? parseInt(body.joiningYear, 10) : null;
    }

    if (hasOwn(body, 'averageIncome')) {
      data.averageIncome = body.averageIncome ? parseFloat(body.averageIncome) : null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Aucune donnee a mettre a jour.' });
    }

    const uniquenessConflict = await findUserUniquenessConflict({
      email: typeof data.email === 'string' ? data.email : undefined,
      phone: data.phone
    }, id);

    if (uniquenessConflict) {
      return res.status(409).json({ error: uniquenessConflict });
    }

    const user = await prisma.user.update({
      where: { id: id as string },
      data
    });
    res.json(user);
  } catch (error: any) {
    console.error('updateUserStatus error:', error);
    const conflictMessage = uniqueConflictMessage(error);
    if (conflictMessage) return res.status(409).json({ error: conflictMessage });
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = { ...req.body };

    delete data.id;
    delete data._id;
    delete data.password;
    delete data.createdAt;
    delete data.updatedAt;
    delete data.accountIds;
    delete data.accounts;
    delete data.userGroups;

    if (hasOwn(data, 'email')) {
      data.email = normalizeEmail(data.email);
    }

    if (hasOwn(data, 'phone')) {
      const normalizedPhone = normalizeText(data.phone);
      if (!normalizedPhone) return res.status(400).json({ error: 'Le numero de telephone est obligatoire.' });
      data.phone = normalizedPhone;
    }

    const parsedRoles = parseRoles(data);
    if (parsedRoles) {
      data.roles = parsedRoles;
      delete data.role;
    } else {
      delete data.role;
      delete data.roles;
    }

    const uniquenessConflict = await findUserUniquenessConflict({
      email: typeof data.email === 'string' ? data.email : undefined,
      phone: data.phone
    }, id);

    if (uniquenessConflict) {
      return res.status(409).json({ error: uniquenessConflict });
    }

    const updatedUser = await prisma.user.update({
      where: { id: id as string },
      data: {
        ...data,
        joiningYear: data.joiningYear ? parseInt(data.joiningYear, 10) : undefined,
        averageIncome: data.averageIncome ? parseFloat(data.averageIncome) : undefined
      },
      include: { userGroups: true }
    });
    res.json(updatedUser);
  } catch (error: any) {
    console.error('updateUserProfile error:', error);
    const conflictMessage = uniqueConflictMessage(error);
    if (conflictMessage) return res.status(409).json({ error: conflictMessage });
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const resetUserPassword = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, firstName: true, lastName: true, roles: true, password: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    if (!user.roles?.includes('ADMIN')) {
      return res.status(400).json({ error: 'Cet utilisateur n est pas un administrateur.' });
    }

    if (!user.email) {
      return res.status(400).json({ error: 'Impossible de reinitialiser le mot de passe: aucun email renseigne.' });
    }

    const plainPassword = generateTemporaryPassword();
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword }
    });

    const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Administrateur';
    try {
      await sendPasswordResetEmail(user.email, displayName, plainPassword);
    } catch (emailError) {
      await prisma.user.update({
        where: { id },
        data: { password: user.password }
      });
      console.error('resetUserPassword email error:', emailError);
      return res.status(500).json({ error: 'Mot de passe non reinitialise: echec de l envoi email.' });
    }

    res.json({ message: 'Mot de passe reinitialise et envoye par email.' });
  } catch (error: any) {
    console.error('resetUserPassword error:', error);
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const creditUserAccount = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, description, accountType = 'PRINCIPAL', sourceAccountType, currency = 'XAF' } = req.body;
    const adminId = req.user?.userId || req.user?.sub || req.user?.id;
    const adminUser = adminId ? await prisma.user.findUnique({ where: { id: adminId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin SystÃ¨me';

    const upperType = accountType.toUpperCase();
    let opType = 'deposit';
    let opCode = `DEPOT_${accountType}_${Date.now()}`;
    let opName = `DÃ©pÃ´t ${accountType}`;
    
    if (upperType === 'EPARGNE') {
      opType = 'epargne';
      opCode = `EPARGNE_${Date.now()}`;
      opName = 'DÃ©pÃ´t Ã‰pargne';
    } else if (upperType === 'CAUTION') {
      opType = 'caution';
      opCode = `CAUTION_${Date.now()}`;
      opName = 'DÃ©pÃ´t Caution';
    } else if (upperType === 'CREDIT' || upperType === 'PRET') {
      opType = 'credit';
      opCode = `EMPRUNT_${Date.now()}`;
      opName = 'DÃ©blocage CrÃ©dit';
    } else if (upperType === 'PRINCIPAL') {
      opType = 'principal';
      opCode = `DEPOT_WALLET_${Date.now()}`;
      opName = 'DÃ©pÃ´t Wallet';
    } else if (upperType === 'PARRAINAGE') {
      opType = 'parrainage';
      opCode = `PARRAINAGE_${Date.now()}`;
      opName = 'DÃ©pÃ´t Parrainage';
    } else if (upperType.includes('DJANGUI')) {
      opType = 'djangui';
      opCode = `DJANGUI_${Date.now()}`;
      opName = 'DÃ©pÃ´t Djangui';
    }

    const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');

    const transaction = await prisma.transaction.create({
      data: {
        userId: id as string,
        purpose: description || opName,
        amount: Number(amount) || 0,
        currency,
        status: 'PENDING',
        transactionRef: `NFS-${Date.now()}`,
        createdBy: adminName,
        createdById: adminId || null,
        sourceAccountType: sourceAccountType || null,
        targetAccountType: accountType,
        operation: {
          type: opType,
          code: opCode,
          reference: `${dateStr}.${upperType.substring(0, 2)}.${id}`,
          amount: Number(amount) || 0,
          date: new Date().toISOString()
        }
      }
    });
    res.json({ message: "OpÃ©ration soumise au COMEX", transaction });
  } catch (error: any) {
    console.error('creditUserAccount error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const validateTransaction = async (req: any, res: Response) => {
  try {
    const { txId } = req.params;
    const adminId = req.user?.userId || req.user?.sub || req.user?.id;
    const adminUser = adminId ? await prisma.user.findUnique({ where: { id: adminId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : '';
    const tx = await prisma.transaction.findUnique({ where: { id: txId } });
    
    if (!tx || tx.status !== 'PENDING') return res.status(400).json({ error: "Transaction invalide." });
    
    // Vérifier les droits COMEX/ADMIN
    const isAuthorized = adminUser?.roles.includes('COMEX') || adminUser?.roles.includes('ADMIN');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Seul un membre du COMEX peut valider une transaction." });
    }

    // Empêcher l'auto-validation
    if ((tx as any).createdById && adminId && (tx as any).createdById === adminId) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez vous-meme initiee." });
    }

    if (!(tx as any).createdById && tx.createdBy && adminName && tx.createdBy === adminName) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez vous-meme initiee." });
    }

    if ((adminId && tx.validatedBy.includes(adminId)) || (adminName && tx.validatedBy.includes(adminName))) {
      return res.status(400).json({ error: "Vous avez déjà validé cette transaction." });
    }

    const newValidators = Array.from(new Set([...tx.validatedBy, adminId || adminName].filter(Boolean)));

    // Vérifier s'il s'agit d'un transfert lié
    const isTransfer = tx.transactionRef?.startsWith('TR_REF_');

    if (isTransfer) {
      const transferRef = tx.transactionRef!.substring(0, tx.transactionRef!.lastIndexOf('_'));
      const linkedTransactions = await prisma.transaction.findMany({
        where: {
          transactionRef: {
            in: [`${transferRef}_OUT`, `${transferRef}_IN`]
          }
        }
      });

      if (linkedTransactions.length !== 2) {
        return res.status(400).json({ error: "Impossible de localiser la transaction de contrepartie liée à ce transfert." });
      }

      const senderTx = linkedTransactions.find((t: any) => t.transactionRef!.endsWith('_OUT'));
      const recipientTx = linkedTransactions.find((t: any) => t.transactionRef!.endsWith('_IN'));

      if (!senderTx || !recipientTx) {
        return res.status(400).json({ error: "Les composants débit/crédit du transfert sont invalides." });
      }

      const mergedValidators = Array.from(new Set([...senderTx.validatedBy, ...recipientTx.validatedBy, adminId || adminName].filter(Boolean)));

      if (mergedValidators.length < 2) {
        // Première validation sur 2
        await prisma.transaction.update({
          where: { id: senderTx.id },
          data: { validatedBy: mergedValidators }
        });
        const updatedRecipientTx = await prisma.transaction.update({
          where: { id: recipientTx.id },
          data: { validatedBy: mergedValidators }
        });

        return res.json({ 
          message: `Validé (1/2) - Transfert en attente de la seconde signature.`, 
          transaction: updatedRecipientTx 
        });
      } else {
        // Deuxième validation : Exécuter les soldes de compte de manière atomique
        const result = await prisma.$transaction(async (dbTx) => {
          const senderUser = await dbTx.user.findUnique({ where: { id: senderTx.userId! } });
          const recipientUser = await dbTx.user.findUnique({ where: { id: recipientTx.userId! } });

          if (!senderUser || !recipientUser) {
            throw new Error("L'expéditeur ou le destinataire du transfert est introuvable.");
          }

          const senderAccounts = await dbTx.account.findMany({ where: { id: { in: senderUser.accountIds } } });
          const recipientAccounts = await dbTx.account.findMany({ where: { id: { in: recipientUser.accountIds } } });

          const sourceAccount = senderAccounts.find(a => a.type === senderTx.sourceAccountType);
          const destAccount = recipientAccounts.find(a => a.type === recipientTx.targetAccountType);

          if (!sourceAccount || !destAccount) {
            throw new Error("Le compte source ou le compte cible du transfert est introuvable.");
          }

          const sourceAmount = Math.abs(senderTx.amount || 0);
          if (sourceAccount.availableBalance < sourceAmount) {
            throw new Error(`Solde insuffisant sur le compte source (${sourceAccount.availableBalance} ${sourceAccount.currency}).`);
          }

          // Déduire chez l'expéditeur
          await dbTx.account.update({
            where: { id: sourceAccount.id },
            data: {
              currentBalance: { decrement: sourceAmount },
              availableBalance: { decrement: sourceAmount }
            }
          });

          // Ajouter chez le destinataire
          const convertedAmount = recipientTx.amount || 0;
          await dbTx.account.update({
            where: { id: destAccount.id },
            data: {
              currentBalance: { increment: convertedAmount },
              availableBalance: { increment: convertedAmount }
            }
          });

          // Mettre à jour les deux transactions à SUCCESS
          await dbTx.transaction.update({
            where: { id: senderTx.id },
            data: { status: 'SUCCESS', validatedBy: mergedValidators }
          });

          const updatedRecipient = await dbTx.transaction.update({
            where: { id: recipientTx.id },
            data: { status: 'SUCCESS', validatedBy: mergedValidators }
          });

          return updatedRecipient;
        });

        return res.json({ 
          message: "Validé (2/2) - Transfert exécuté avec succès.", 
          transaction: result 
        });
      }
    } else {
      // Cas standard (Dépôt / Crédit direct)
      if (newValidators.length < 2) {
        const updatedTx = await prisma.transaction.update({
          where: { id: tx.id },
          data: { validatedBy: newValidators }
        });
        return res.json({ message: "Validé (1/2) - En attente de la seconde signature.", transaction: updatedTx });
      } else {
        const user = await prisma.user.findUnique({ where: { id: tx.userId! } });
        const accounts = await prisma.account.findMany({ where: { id: { in: user!.accountIds } } });
        let sourceAccount = tx.sourceAccountType ? accounts.find(a => a.type === tx.sourceAccountType) : null;
        let targetAccount = accounts.find(a => a.type === tx.targetAccountType);
        
        await prisma.$transaction(async (dbTx) => {
          if (sourceAccount) {
            await dbTx.account.update({
              where: { id: sourceAccount.id },
              data: { 
                currentBalance: { decrement: tx.amount! }, 
                availableBalance: { decrement: tx.amount! } 
              }
            });
          }
          if (targetAccount) {
            await dbTx.account.update({
              where: { id: targetAccount.id },
              data: { 
                currentBalance: { increment: tx.amount! }, 
                availableBalance: { increment: tx.amount! } 
              }
            });
          }
          await dbTx.transaction.update({
            where: { id: tx.id },
            data: { status: 'SUCCESS', validatedBy: newValidators }
          });
        });

        const updatedTx = await prisma.transaction.findUnique({ where: { id: tx.id } });
        return res.json({ message: "Validé (2/2) - Transaction exécutée avec succès.", transaction: updatedTx });
      }
    }
  } catch (error: any) {
    console.error('validateTransaction error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const rejectTransaction = async (req: any, res: Response) => {
  try {
    const { txId } = req.params;
    const tx = await prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) return res.status(404).json({ error: "Transaction introuvable" });

    // Si c'est un transfert, rejeter les deux côtés
    if (tx.transactionRef?.startsWith('TR_REF_')) {
      const transferRef = tx.transactionRef.substring(0, tx.transactionRef.lastIndexOf('_'));
      await prisma.transaction.updateMany({
        where: { transactionRef: { in: [`${transferRef}_OUT`, `${transferRef}_IN`] } },
        data: { status: 'REJECTED' }
      });
      const updatedTx = await prisma.transaction.findUnique({ where: { id: txId } });
      return res.json(updatedTx);
    }

    const updatedTx = await prisma.transaction.update({
      where: { id: txId },
      data: { status: 'REJECTED' }
    });
    res.json(updatedTx);
  } catch (error: any) {
    console.error('rejectTransaction error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const [userCount, transactionCount, pendingLoans, activeCotisations, accountGroups, approvedLoans] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
      prisma.loan.count({ where: { status: 'PENDING' } }),
      prisma.cotisationGroup.count({ where: { status: 'ACTIF' } }),
      prisma.account.groupBy({
        by: ['type'],
        _sum: {
          currentBalance: true,
          availableBalance: true
        }
      }),
      prisma.loan.findMany({
        where: { status: 'APPROVED' },
        include: { user: true }
      })
    ]);

    const maturingLoans = approvedLoans.filter(l => {
      if (!l.dueDate) return false;
      return l.dueDate.getMonth() === currentMonth && l.dueDate.getFullYear() === currentYear;
    });

    // Calcul de la capacitÃ© d'avalise totale rÃ©elle (somme des capacitÃ©s individuelles >= 0)
    const users = await prisma.user.findMany({ select: { accountIds: true } });
    const allAccountIds = users.flatMap(u => u.accountIds || []);
    const accounts = await prisma.account.findMany({
      where: { id: { in: allAccountIds } }
    });

    let volumePrincipal = 0;
    let volumeEpargne = 0;
    let volumeCaution = 0;
    let volumeCotisation = 0;
    let totalAvaliseCapacity = 0;

    // Calcul basÃ© uniquement sur les comptes rattachÃ©s Ã  des utilisateurs (exclut les comptes SystÃ¨me/Provider)
    for (const user of users) {
      const userAccounts = accounts.filter(a => (user.accountIds || []).includes(a.id));
      const getBal = (type: string) => userAccounts.find(a => a.type === type)?.currentBalance || 0;
      
      // Volume par type
      volumePrincipal += getBal('PRINCIPAL');
      volumeEpargne += getBal('EPARGNE');
      volumeCaution += getBal('CAUTION');
      volumeCotisation += (getBal('DJANGUI_NON_PERCU') || getBal('DJANGUI_PERCU') || getBal('DJANGUI_NONPERCU'));

      // CapacitÃ© d'avalise (clampÃ©e Ã  0)
      const epargne = getBal('EPARGNE');
      const djanguiNonPercu = getBal('DJANGUI_NON_PERCU') || getBal('DJANGUI_NONPERCU');
      const credit = getBal('CREDIT');
      const pret = getBal('PRET');
      const creditAvalise = getBal('CREDIT_AVALISE');
      const parrainage = getBal('PARRAINAGE');
      
      const capacity = (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage);
      totalAvaliseCapacity += Math.max(0, capacity);
    }

    const totalAssets = volumePrincipal + volumeEpargne + volumeCaution + volumeCotisation;

    res.json({ 
      userCount, 
      volumePrincipal,
      volumeEpargne,
      volumeCaution,
      volumeCotisation,
      totalAssets,
      transactionCount, 
      pendingLoans,
      totalAvaliseCapacity,
      activeCotisations,
      maturingLoans
    });
  } catch (error: any) {
    console.error('getDashboardStats error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const createCotisationGroup = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const group = await prisma.cotisationGroup.create({ data: { ...data, status: 'ACTIF' } });
    res.status(201).json(group);
  } catch (error: any) {
    console.error('createCotisationGroup error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const updateCotisationGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const group = await prisma.cotisationGroup.update({
      where: { id: id as string },
      data
    });
    res.json(group);
  } catch (error: any) {
    console.error('updateCotisationGroup error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCotisations = async (req: Request, res: Response) => {
  try {
    const groups = await prisma.cotisationGroup.findMany({ include: { members: true } });
    res.json(groups);
  } catch (error: any) {
    console.error('getCotisations error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const addParticipantToCotisation = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    const updated = await prisma.cotisationGroup.update({
      where: { id: groupId },
      data: { members: { connect: { id: userId } } },
      include: { members: true }
    });
    res.json(updated);
  } catch (error: any) {
    console.error('addParticipantToCotisation error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const removeParticipantFromCotisation = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    const updated = await prisma.cotisationGroup.update({
      where: { id: groupId },
      data: { members: { disconnect: { id: userId } } },
      include: { members: true }
    });
    res.json(updated);
  } catch (error: any) {
    console.error('removeParticipantFromCotisation error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const payCotisationFromCaution = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    res.json({ message: "PayÃ© via Caution" });
  } catch (error: any) {
    console.error('payCotisationFromCaution error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const payCotisationInCash = async (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.body;
    res.json({ message: "PayÃ© en espÃ¨ces" });
  } catch (error: any) {
    console.error('payCotisationInCash error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getLoans = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      where.user = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } }
        ]
      };
    }

    const total = await prisma.loan.count({ where });

    const loans = await prisma.loan.findMany({ 
      where,
      include: { user: true }, 
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });
    
    const loanUserIds = [...new Set(loans.map(l => l.userId))];
    const txs = await prisma.transaction.findMany({
      where: {
        userId: { in: loanUserIds },
        purpose: { contains: "CREDIT" }
      },
      orderBy: { createdAt: 'desc' }
    });

    const allUsers = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true }
    });
    const userMap = new Map();
    allUsers.forEach(u => userMap.set(u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim()));
    
    const mapped = loans.map((l: any) => {
      let avalList = l.avalistes || [];
      
      if (!avalList || avalList.length === 0) {
        const tx = txs.find((t: any) => t.userId === l.userId && t.amount === l.amount);
        if (tx && tx.operation) {
           const op = tx.operation as any;
           avalList = op.avalistes || op.avaliste || [];
           if ((!avalList || avalList.length === 0) && op.beneficiary) {
             avalList = Array.isArray(op.beneficiary) ? op.beneficiary : [op.beneficiary];
           }
        }
      }

      if (Array.isArray(avalList)) {
        avalList = avalList.map((aval: any) => {
          if (!aval.name && aval.userId) {
             aval.name = userMap.get(aval.userId) || "Inconnu";
          }
          return aval;
        });
      }
      
      return {
        ...l,
        avaliste: avalList,
        avalistes: avalList
      };
    });
    res.json({
      data: mapped,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error: any) {
    console.error('getLoans error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const updateLoanStatus = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const adminId = req.user?.userId || req.user?.sub || req.user?.id;
    const adminUser = adminId ? await prisma.user.findUnique({ where: { id: adminId } }) : null;
    if (!adminUser) return res.status(401).json({ error: "Non authentifié" });

    const isAuthorized = adminUser.roles.includes('COMEX') || adminUser.roles.includes('ADMIN');
    if (!isAuthorized) {
      return res.status(403).json({ error: "Seul un membre du COMEX peut valider un crédit." });
    }

    const loan = await prisma.loan.findUnique({ where: { id: id as string } });
    if (!loan) return res.status(404).json({ error: "Prêt non trouvé" });

    const adminName = `${adminUser.firstName} ${adminUser.lastName}`;
    if (status === 'APPROVED' && (loan as any).createdById && adminId && (loan as any).createdById === adminId) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider un credit que vous avez vous-meme saisi." });
    }

    if (status === 'APPROVED' && !(loan as any).createdById && loan.createdBy && loan.createdBy === adminName) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider un credit que vous avez vous-meme saisi." });
    }

    const updatedLoan = await prisma.loan.update({
      where: { id: id as string },
      data: { 
        status: status as string,
        validatedBy: status === 'APPROVED' ? [adminId || adminName] : undefined,
        approvedAt: status === 'APPROVED' ? new Date() : undefined,
        dueDate: status === 'APPROVED' ? new Date(new Date().getTime() + (loan.duration || 30) * 24 * 60 * 60 * 1000) : undefined
      },
      include: { user: true }
    });

    if (status === 'APPROVED' && loan.amount) {
      // 1. Créditer le compte PRINCIPAL de l'emprunteur
      const borrower = await prisma.user.findUnique({ where: { id: loan.userId }, select: { accountIds: true } });
      if (borrower && borrower.accountIds) {
        const principalAcc = await prisma.account.findFirst({
          where: { id: { in: borrower.accountIds }, type: 'PRINCIPAL' }
        });
        if (principalAcc) {
          await prisma.account.update({
            where: { id: principalAcc.id },
            data: {
              currentBalance: { increment: loan.amount },
              availableBalance: { increment: loan.amount }
            }
          });
        }
      }
      
      // 2. Mettre à jour la transaction PENDING associée
      await prisma.transaction.updateMany({
        where: { userId: loan.userId, purpose: loan.purpose, status: 'PENDING' },
        data: { status: 'SUCCESS', validatedBy: [adminId || adminName] }
      });
    }

    if (status === 'APPROVED' && loan.avalistes && Array.isArray(loan.avalistes)) {
      for (const avaliste of loan.avalistes as any[]) {
        if (!avaliste.userId || !avaliste.amount) continue;
        const userAccounts = await prisma.user.findUnique({ where: { id: avaliste.userId }, select: { accountIds: true } });
        if (userAccounts && userAccounts.accountIds) {
          const creditAvaliseAcc = await prisma.account.findFirst({
            where: { id: { in: userAccounts.accountIds }, type: 'CREDIT_AVALISE' }
          });
          if (creditAvaliseAcc) {
            await prisma.account.update({
              where: { id: creditAvaliseAcc.id },
              data: {
                currentBalance: { increment: Number(avaliste.amount) },
                availableBalance: { increment: Number(avaliste.amount) }
              }
            });
          } else {
            const newAcc = await prisma.account.create({
              data: { type: 'CREDIT_AVALISE', currency: 'XAF', currentBalance: Number(avaliste.amount), availableBalance: Number(avaliste.amount) }
            });
            await prisma.user.update({
              where: { id: avaliste.userId },
              data: { accountIds: { push: newAcc.id } }
            });
          }
        }
      }
    }

    res.json(updatedLoan);
  } catch (error: any) {
    console.error('updateLoanStatus error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const createLoan = async (req: any, res: Response) => {
  try {
    const { userId, amount, duration, purpose, avalistes, interestRate } = req.body;

    // ─── VÉRIFICATION 1 : Champs obligatoires ───────────────────────────────
    if (!userId || !amount || !duration || !interestRate) {
      return res.status(400).json({ error: "Les champs userId, amount, duration et interestRate sont obligatoires." });
    }

    const loanAmount = parseFloat(amount);
    const loanDuration = parseInt(duration);
    const loanRate = parseFloat(interestRate);

    if (isNaN(loanAmount) || loanAmount <= 0) {
      return res.status(400).json({ error: "Le montant du crédit doit être un nombre positif." });
    }
    if (isNaN(loanDuration) || loanDuration <= 0) {
      return res.status(400).json({ error: "La durée du crédit doit être un entier positif (en jours)." });
    }
    if (isNaN(loanRate) || loanRate < 0) {
      return res.status(400).json({ error: "Le taux d'intérêt doit être un nombre positif ou nul." });
    }

    // ─── VÉRIFICATION 2 : Existence et statut de l'emprunteur ───────────────
    const borrower = await prisma.user.findUnique({
      where: { id: userId as string }
    });
    if (!borrower) {
      return res.status(404).json({ error: "Client introuvable. Veuillez vérifier l'identifiant." });
    }
    if (!borrower.activated) {
      return res.status(400).json({ error: `Le compte de ${borrower.firstName} ${borrower.lastName} est désactivé. Impossible de créer un crédit.` });
    }
    if (!borrower.verified) {
      return res.status(400).json({ error: `Le KYC de ${borrower.firstName} ${borrower.lastName} n'est pas vérifié. Le crédit ne peut être accordé qu'à un client vérifié.` });
    }

    // ─── VÉRIFICATION 2b : Capacité d'avalise de l'emprunteur ≥ 1/3 du montant ─
    const borrowerAccounts = await prisma.account.findMany({
      where: { id: { in: borrower.accountIds || [] } }
    });
    const getBorrowerBal = (type: string) => borrowerAccounts.find(a => a.type === type)?.currentBalance || 0;
    const borrowerEpargne = getBorrowerBal('EPARGNE');
    const borrowerDjangui = getBorrowerBal('DJANGUI_NON_PERCU') || getBorrowerBal('DJANGUI_NONPERCU');
    const borrowerCredit = getBorrowerBal('CREDIT');
    const borrowerPret = getBorrowerBal('PRET');
    const borrowerCreditAvalise = getBorrowerBal('CREDIT_AVALISE');
    const borrowerParrainage = getBorrowerBal('PARRAINAGE');
    const borrowerAvaliseCapacity = Math.max(0,
      (borrowerEpargne + borrowerDjangui) - (borrowerCredit + borrowerPret + borrowerCreditAvalise + borrowerParrainage)
    );
    const minRequiredCapacity = loanAmount / 3;

    if (borrowerAvaliseCapacity < minRequiredCapacity) {
      return res.status(400).json({
        error: `Capacité d'avalise insuffisante pour ${borrower.firstName} ${borrower.lastName}. ` +
          `Pour un crédit de ${loanAmount.toLocaleString('fr-FR')} XAF, une capacité d'avalise d'au moins ` +
          `${Math.ceil(minRequiredCapacity).toLocaleString('fr-FR')} XAF (1/3 du montant) est requise. ` +
          `Capacité actuelle : ${borrowerAvaliseCapacity.toLocaleString('fr-FR')} XAF.`
      });
    }

    // ─── VÉRIFICATION 3 : Pas de crédit en cours (PENDING ou APPROVED) ───────
    const existingLoan = await prisma.loan.findFirst({
      where: {
        userId: userId as string,
        status: { in: ['PENDING', 'APPROVED'] }
      }
    });
    if (existingLoan) {
      const statusLabel = existingLoan.status === 'PENDING' ? 'en attente de validation' : 'déjà actif';
      return res.status(400).json({
        error: `${borrower.firstName} ${borrower.lastName} possède déjà un crédit ${statusLabel} (montant : ${existingLoan.amount.toLocaleString('fr-FR')} XAF). Un nouveau crédit ne peut être créé qu'après le remboursement ou le rejet du précédent.`
      });
    }

    // ─── VÉRIFICATION 4 : Avalistes obligatoires et valides ──────────────────
    const avalisteList = Array.isArray(avalistes) ? avalistes : [];
    if (avalisteList.length === 0) {
      return res.status(400).json({ error: "Au moins un avaliste est requis pour accorder un crédit." });
    }

    // Validation de chaque avaliste
    const errors: string[] = [];
    const validatedAvalistes: any[] = [];

    for (const aval of avalisteList) {
      if (!aval.userId || !aval.amount) {
        errors.push("Chaque avaliste doit avoir un userId et un montant d'avalise.");
        continue;
      }

      const avalAmount = parseFloat(aval.amount);
      if (isNaN(avalAmount) || avalAmount <= 0) {
        errors.push(`Le montant d'avalise pour l'avaliste ${aval.userId} doit être positif.`);
        continue;
      }

      // Vérifier que l'avaliste existe
      const avalUser = await prisma.user.findUnique({
        where: { id: aval.userId as string }
      });
      if (!avalUser) {
        errors.push(`Avaliste avec l'ID ${aval.userId} introuvable.`);
        continue;
      }
      if (!avalUser.activated) {
        errors.push(`Le compte de l'avaliste ${avalUser.firstName} ${avalUser.lastName} est désactivé.`);
        continue;
      }

      // L'avaliste ne peut pas être le même que l'emprunteur
      if (aval.userId === userId) {
        errors.push(`${avalUser.firstName} ${avalUser.lastName} ne peut pas être à la fois emprunteur et avaliste.`);
        continue;
      }

      // Calculer la capacité d'avalise de l'avaliste
      const avalAccounts = await prisma.account.findMany({
        where: { id: { in: avalUser.accountIds || [] } }
      });
      const getBalance = (type: string) => avalAccounts.find(a => a.type === type)?.currentBalance || 0;
      const epargne = getBalance('EPARGNE');
      const djanguiNonPercu = getBalance('DJANGUI_NON_PERCU') || getBalance('DJANGUI_NONPERCU');
      const credit = getBalance('CREDIT');
      const pret = getBalance('PRET');
      const creditAvalise = getBalance('CREDIT_AVALISE');
      const parrainage = getBalance('PARRAINAGE');
      const avaliseCapacity = Math.max(0, (epargne + djanguiNonPercu) - (credit + pret + creditAvalise + parrainage));

      if (avaliseCapacity < avalAmount) {
        errors.push(
          `Capacité d'avalise insuffisante pour ${avalUser.firstName} ${avalUser.lastName} : ` +
          `disponible ${avaliseCapacity.toLocaleString('fr-FR')} XAF, requis ${avalAmount.toLocaleString('fr-FR')} XAF.`
        );
        continue;
      }

      validatedAvalistes.push({
        ...aval,
        name: `${avalUser.firstName} ${avalUser.lastName}`,
        amount: avalAmount
      });
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' | ') });
    }

    // ─── VÉRIFICATION 5 : Couverture totale par les avalistes ────────────────
    const totalAvalCoverage = validatedAvalistes.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    if (totalAvalCoverage < loanAmount) {
      return res.status(400).json({
        error: `La couverture totale des avalistes (${totalAvalCoverage.toLocaleString('fr-FR')} XAF) est insuffisante pour couvrir le montant du crédit (${loanAmount.toLocaleString('fr-FR')} XAF).`
      });
    }

    // ─── Création du crédit après toutes les vérifications ───────────────────
    const adminId = req.user?.userId || req.user?.sub || req.user?.id;
    const adminUser = adminId ? await prisma.user.findUnique({ where: { id: adminId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';

    const loan = await prisma.loan.create({
      data: {
        userId,
        amount: loanAmount,
        duration: loanDuration,
        interestRate: loanRate,
        totalInterest: loanAmount * (loanRate / 100),
        purpose,
        status: 'PENDING',
        avalistes: validatedAvalistes,
        createdBy: adminName,
        createdById: adminId || null
      },
      include: { user: true }
    });

    res.status(201).json(loan);
  } catch (error: any) {
    console.error('createLoan error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

const transactionUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true
};

const slimOperation = (operation: any) => {
  if (!operation || typeof operation !== 'object') return operation;

  const avalistes = operation.avalistes || operation.avaliste;
  const slimAvalistes = Array.isArray(avalistes)
    ? avalistes.map((avaliste: any) => ({
        userId: avaliste?.userId,
        firstName: avaliste?.firstName,
        lastName: avaliste?.lastName,
        phone: avaliste?.phone,
        amount: avaliste?.amount,
        interestShare: avaliste?.interestShare,
      }))
    : avalistes;

  return {
    code: operation.code,
    name: operation.name,
    description: operation.description,
    avalistes: slimAvalistes,
    avaliste: slimAvalistes,
  };
};

const mapTransactionForList = (t: any) => {
  const operation = slimOperation(t.operation);
  const avalList = operation?.avalistes || operation?.avaliste || t.avalistes || t.avaliste || [];

  return {
    id: t.id,
    userId: t.userId,
    user: t.user,
    purpose: t.purpose,
    description: operation?.description || t.purpose,
    amount: t.amount,
    status: t.status,
    transactionRef: t.transactionRef,
    reference: t.transactionRef,
    createdBy: t.createdBy,
    validatedBy: t.validatedBy || [],
    targetAccountType: t.targetAccountType,
    sourceAccountType: t.sourceAccountType,
    currency: t.currency,
    operation,
    avaliste: avalList,
    avalistes: avalList,
    createdAt: t.createdAt,
    approvedAt: t.approvedAt,
    dueDate: t.dueDate,
    penaltyAmount: t.penaltyAmount,
  };
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 0;
    const scope = req.query.scope as string | undefined;
    const where = scope === 'admin'
      ? { AND: [{ createdBy: { not: null } }, { createdBy: { not: 'System' } }] }
      : scope === 'mobile'
        ? { OR: [{ createdBy: null }, { createdBy: 'System' }] }
        : {};

    if (limit > 0) {
      const skip = (page - 1) * limit;
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: transactionUserSelect } }
        }),
        prisma.transaction.count({ where })
      ]);
      const mapped = transactions.map(mapTransactionForList);
      return res.json({ data: mapped, total, page, totalPages: Math.ceil(total / limit) });
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: transactionUserSelect } }
    });
    const mapped = transactions.map(mapTransactionForList);
    res.json(mapped);
  } catch (error: any) {
    console.error('getTransactions error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getReferralStats = async (req: Request, res: Response) => {
  try {
    const [totalUsers, referredUsers, parrainageAccounts] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { referredById: { not: null } } }),
      prisma.account.aggregate({
        where: { type: 'PARRAINAGE' },
        _sum: { currentBalance: true }
      })
    ]);

    const totalCommissions = parrainageAccounts._sum.currentBalance || 0;
    const conversionRate = totalUsers > 0 ? (referredUsers / totalUsers) * 100 : 0;

    // Get top referrers
    const topReferrersRaw = await prisma.user.groupBy({
      by: ['referredById'],
      _count: { id: true },
      where: { referredById: { not: null } },
      orderBy: { _count: { id: 'desc' } },
      take: 10
    });

    const topReferrers = await Promise.all(topReferrersRaw.map(async (ref) => {
      const user = await prisma.user.findUnique({
        where: { id: ref.referredById! }
      });
      
      const parrainageAcc = await prisma.account.findFirst({
        where: {
          id: { in: user?.accountIds || [] },
          type: 'PARRAINAGE'
        }
      });

      return {
        id: user?.id,
        name: `${user?.firstName} ${user?.lastName}`,
        code: user?.referralCode,
        referralsCount: ref._count.id,
        commissions: parrainageAcc?.currentBalance || 0
      };
    }));

    res.json({
      totalReferrals: referredUsers,
      totalCommissions,
      conversionRate: Math.round(conversionRate),
      topReferrers
    });
  } catch (error: any) {
    console.error('getReferralStats error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getGroups = async (req: Request, res: Response) => {
  try {
    const groups = await prisma.userGroup.findMany({ include: { users: true } });
    res.json(groups);
  } catch (e: any) {
    console.error('getGroups error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const getPermissionCatalog = async (req: Request, res: Response) => {
  res.json({ data: permissionCatalog });
};

export const getMyPermissions = async (req: any, res: Response) => {
  const { permissions, allAccess } = getEffectivePermissions(req);
  res.json({ data: { permissions, allAccess } });
};

export const createGroup = async (req: Request, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    const group = await prisma.userGroup.create({
      data: { name, description, permissions: normalizePermissions(permissions) }
    });
    res.json(group);
  } catch (e: any) {
    console.error('createGroup error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const updateGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    if ('permissions' in data) {
      data.permissions = normalizePermissions(data.permissions);
    }
    const group = await prisma.userGroup.update({ where: { id: id as string }, data });
    res.json(group);
  } catch (e: any) {
    console.error('updateGroup error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const assignUserGroups = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { groupIds } = req.body;
    const parsedRoles = parseRoles(req.body);

    let finalRoles = parsedRoles;
    if (!finalRoles) {
      const existingUser = await prisma.user.findUnique({ where: { id: id as string } });
      finalRoles = existingUser?.roles || [];
    }

    if (groupIds && Array.isArray(groupIds)) {
      const groups = await prisma.userGroup.findMany({
        where: { id: { in: groupIds } }
      });
      const hasComexGroup = groups.some(g => g.name.toUpperCase() === 'COMEX' || g.name.toUpperCase() === 'COMMEX');
      if (hasComexGroup) {
        if (!finalRoles.includes('COMEX')) finalRoles = [...finalRoles, 'COMEX'];
        if (!finalRoles.includes('ADMIN')) finalRoles = [...finalRoles, 'ADMIN'];
      } else {
        finalRoles = finalRoles.filter(r => r !== 'COMEX');
      }
    }

    const updateData: any = {};
    if (groupIds && Array.isArray(groupIds)) {
      updateData.userGroups = { set: groupIds.map((gid: string) => ({ id: gid })) };
    }
    updateData.roles = finalRoles;

    const user = await prisma.user.update({
      where: { id: id as string },
      data: updateData,
      include: { userGroups: true }
    });
    res.json(user);
  } catch (e: any) {
    console.error('assignUserGroups error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const getCurrencies = async (req: Request, res: Response) => {
  try {
    const currencies = await prisma.currency.findMany({ where: { isActive: true } });
    res.json(currencies);
  } catch (e: any) {
    console.error('getCurrencies error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const syncCurrencies = async (req: Request, res: Response) => {
  try { 
    await updateExchangeRates(); 
    res.json({ message: "OK" }); 
  } catch (e: any) { 
    console.error('syncCurrencies error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message }); 
  }
};

export const getLoanConfigs = async (req: Request, res: Response) => {
  try {
    const configs = await prisma.loanConfig.findMany({ orderBy: { code: 'asc' } });
    res.json(configs);
  } catch (error: any) {
    console.error('getLoanConfigs error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const createLoanConfig = async (req: Request, res: Response) => {
  try {
    const { code, rate, duration } = req.body;
    
    // VÃ©rifier si le code existe dÃ©jÃ 
    const existing = await prisma.loanConfig.findUnique({ where: { code } });
    if (existing) {
      return res.status(400).json({ error: `Le code crÃ©dit "${code}" existe dÃ©jÃ .` });
    }

    const config = await prisma.loanConfig.create({
      data: { code, rate: parseFloat(rate), duration: parseInt(duration) }
    });
    res.status(201).json(config);
  } catch (error: any) {
    console.error('createLoanConfig error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
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
  } catch (error: any) {
    console.error('updateLoanConfig error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const deleteLoanConfig = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.loanConfig.delete({ where: { id: id as string } });
    res.json({ message: 'Configuration supprimÃ©e' });
  } catch (error: any) {
    console.error('deleteLoanConfig error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
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
  } catch (e: any) {
    console.error('updateUserKYC error:', e);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  }
};

export const adminTransfer = async (req: any, res: Response) => {
  try {
    const { 
      sourceUserId, 
      sourceAccountType, 
      destUserId, 
      destAccountType, 
      amount, 
      purpose 
    } = req.body;

    const adminId = req.user?.userId || req.user?.sub || req.user?.id;
    const adminUser = adminId ? await prisma.user.findUnique({ where: { id: adminId } }) : null;
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : 'Admin Système';

    if (!sourceUserId || !sourceAccountType || !destUserId || !destAccountType || !amount) {
      return res.status(400).json({ error: "Tous les champs (expéditeur, compte source, destinataire, compte cible, montant) sont requis." });
    }

    const transferAmount = Number(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ error: "Le montant du transfert doit être un nombre positif." });
    }

    // 1. Rechercher l'expéditeur et le destinataire
    const sourceUser = await prisma.user.findUnique({ where: { id: sourceUserId } });
    if (!sourceUser) return res.status(404).json({ error: "Client expéditeur introuvable." });

    const destUser = await prisma.user.findUnique({ where: { id: destUserId } });
    if (!destUser) return res.status(404).json({ error: "Client destinataire introuvable." });

    // 2. Récupérer les comptes associés
    const sourceAccounts = await prisma.account.findMany({
      where: { id: { in: sourceUser.accountIds || [] } }
    });
    const destAccounts = await prisma.account.findMany({
      where: { id: { in: destUser.accountIds || [] } }
    });

    const sourceAccount = sourceAccounts.find(a => a.type === sourceAccountType);
    const destAccount = destAccounts.find(a => a.type === destAccountType);

    if (!sourceAccount) {
      return res.status(400).json({ error: `Compte source de type ${sourceAccountType} introuvable.` });
    }
    if (!destAccount) {
      return res.status(400).json({ error: `Compte destinataire de type ${destAccountType} introuvable.` });
    }

    // 3. Calculer les frais de transfert
    const sourceCurrencyCode = sourceAccount.currency || 'XAF';
    const feeDetails = await calculateTransferFee(transferAmount, sourceCurrencyCode);
    const fee = feeDetails.fee;

    // Vérifier le solde disponible (montant + frais)
    const totalRequired = transferAmount + fee;
    if (sourceAccount.availableBalance < totalRequired) {
      return res.status(400).json({ 
        error: `Solde insuffisant pour couvrir le transfert et les frais. Requis : ${totalRequired} ${sourceCurrencyCode}, Disponible : ${sourceAccount.availableBalance} ${sourceCurrencyCode}` 
      });
    }

    // 4. Calculer le taux de change
    const destCurrencyCode = destAccount.currency || 'XAF';
    
    let conversionRate = 1.0;
    let convertedAmount = transferAmount;

    if (sourceCurrencyCode !== destCurrencyCode) {
      const sourceCurrency = await prisma.currency.findUnique({ where: { code: sourceCurrencyCode } });
      const destCurrency = await prisma.currency.findUnique({ where: { code: destCurrencyCode } });

      const sourceRateToBase = sourceCurrency ? sourceCurrency.rateToBase : (sourceCurrencyCode === 'XAF' ? 1.0 : null);
      const destRateToBase = destCurrency ? destCurrency.rateToBase : (destCurrencyCode === 'XAF' ? 1.0 : null);

      if (sourceRateToBase === null || destRateToBase === null) {
        return res.status(400).json({ error: "Impossible de calculer le taux de change pour l'une des devises." });
      }

      // Convertir via la devise de base (XAF)
      conversionRate = sourceRateToBase / destRateToBase;
      convertedAmount = transferAmount * conversionRate;
    }

    // 5. Générer la référence commune pour lier les deux transactions
    const transferRef = `TR_REF_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');

    // 6. Créer les deux transactions liées à l'état PENDING
    const result = await prisma.$transaction(async (tx) => {
      // Créer la transaction de sortie chez l'expéditeur
      const senderTx = await tx.transaction.create({
        data: {
          userId: sourceUser.id,
          amount: -totalRequired,
          currency: sourceCurrencyCode,
          status: 'PENDING',
          purpose: purpose || `Transfert vers ${destUser.firstName} ${destUser.lastName}`,
          transactionRef: `${transferRef}_OUT`,
          sourceAccountType,
          targetAccountType: destAccountType,
          createdBy: adminName,
          createdById: adminId || null,
          operation: {
            type: "transfer_out",
            code: `${transferRef}_OUT`,
            reference: `${dateStr}.TR-OUT.${sourceUser.id}`,
            amount: -transferAmount,
            fee: fee,
            feeRate: feeDetails.rate,
            flatFee: feeDetails.flatFee,
            totalAmount: -totalRequired,
            date: new Date().toISOString(),
            recipient: {
              id: destUser.id,
              firstName: destUser.firstName,
              lastName: destUser.lastName,
              accountNumber: destUser.accountNumber
            },
            exchangeRate: conversionRate,
            convertedAmount: -convertedAmount,
            destCurrency: destCurrencyCode,
            transferRef: transferRef
          }
        }
      });

      // Créer la transaction d'entrée chez le destinataire
      const recipientTx = await tx.transaction.create({
        data: {
          userId: destUser.id,
          amount: convertedAmount,
          currency: destCurrencyCode,
          status: 'PENDING',
          purpose: purpose || `Transfert reçu de ${sourceUser.firstName} ${sourceUser.lastName}`,
          transactionRef: `${transferRef}_IN`,
          sourceAccountType,
          targetAccountType: destAccountType,
          createdBy: adminName,
          createdById: adminId || null,
          operation: {
            type: "transfer_in",
            code: `${transferRef}_IN`,
            reference: `${dateStr}.TR-IN.${destUser.id}`,
            amount: convertedAmount,
            date: new Date().toISOString(),
            sender: {
              id: sourceUser.id,
              firstName: sourceUser.firstName,
              lastName: sourceUser.lastName,
              accountNumber: sourceUser.accountNumber
            },
            exchangeRate: conversionRate,
            sourceAmount: transferAmount,
            sourceCurrency: sourceCurrencyCode,
            transferRef: transferRef
          }
        }
      });

      return { senderTx, recipientTx };
    });

    return res.status(200).json({
      message: "Opération soumise au COMEX avec succès.",
      data: result
    });

  } catch (error: any) {
    console.error('adminTransfer error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

// Helper de calcul des frais de transfert
export const calculateTransferFee = async (amount: number, currency: string): Promise<{ fee: number; rate: number; flatFee: number }> => {
  try {
    let config = await prisma.transferFeeConfig.findFirst({
      where: {
        currency: currency,
        isActive: true,
        minAmount: { lte: amount },
        maxAmount: { gte: amount }
      }
    });

    if (!config && currency !== 'XAF') {
      const srcCurrency = await prisma.currency.findUnique({ where: { code: currency } });
      const srcRateToBase = srcCurrency ? srcCurrency.rateToBase : null;

      if (srcRateToBase !== null && srcRateToBase > 0) {
        const amountInBase = amount * srcRateToBase;
        const baseConfig = await prisma.transferFeeConfig.findFirst({
          where: {
            currency: 'XAF',
            isActive: true,
            minAmount: { lte: amountInBase },
            maxAmount: { gte: amountInBase }
          }
        });

        if (baseConfig) {
          const feeInBase = (amountInBase * baseConfig.rate / 100) + baseConfig.flatFee;
          const feeInSource = feeInBase / srcRateToBase;
          const flatFeeInSource = baseConfig.flatFee / srcRateToBase;

          return {
            fee: parseFloat(feeInSource.toFixed(4)),
            rate: baseConfig.rate,
            flatFee: parseFloat(flatFeeInSource.toFixed(4))
          };
        }
      }
    }

    if (config) {
      const calculatedFee = (amount * config.rate / 100) + config.flatFee;
      return {
        fee: parseFloat(calculatedFee.toFixed(4)),
        rate: config.rate,
        flatFee: config.flatFee
      };
    }

    return { fee: 0, rate: 0, flatFee: 0 };
  } catch (error) {
    console.error('calculateTransferFee error:', error);
    return { fee: 0, rate: 0, flatFee: 0 };
  }
};

// CRUD TransferFeeConfig
export const getTransferFees = async (req: Request, res: Response) => {
  try {
    const fees = await prisma.transferFeeConfig.findMany({
      orderBy: { minAmount: 'asc' }
    });
    res.json(fees);
  } catch (error: any) {
    console.error('getTransferFees error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const createTransferFee = async (req: Request, res: Response) => {
  try {
    const { minAmount, maxAmount, rate, flatFee, isActive } = req.body;
    const config = await prisma.transferFeeConfig.create({
      data: {
        minAmount: parseFloat(minAmount),
        maxAmount: parseFloat(maxAmount),
        rate: parseFloat(rate),
        flatFee: flatFee ? parseFloat(flatFee) : 0,
        currency: 'XAF',
        isActive: isActive !== undefined ? Boolean(isActive) : true
      }
    });
    res.status(201).json(config);
  } catch (error: any) {
    console.error('createTransferFee error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const updateTransferFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { minAmount, maxAmount, rate, flatFee, isActive } = req.body;
    const config = await prisma.transferFeeConfig.update({
      where: { id: id as string },
      data: {
        minAmount: minAmount !== undefined ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount !== undefined ? parseFloat(maxAmount) : undefined,
        rate: rate !== undefined ? parseFloat(rate) : undefined,
        flatFee: flatFee !== undefined ? parseFloat(flatFee) : undefined,
        currency: 'XAF',
        isActive: isActive !== undefined ? Boolean(isActive) : undefined
      }
    });
    res.json(config);
  } catch (error: any) {
    console.error('updateTransferFee error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const deleteTransferFee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.transferFeeConfig.delete({
      where: { id: id as string }
    });
    res.json({ message: 'Configuration de frais supprimée' });
  } catch (error: any) {
    console.error('deleteTransferFee error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};




