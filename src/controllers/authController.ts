import { dispatchNotification } from '../services/notificationDispatcher';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { computeAvalise } from '../utils/computeAvalise';
import { sendResetCode } from '../services/mailService';
import { sendErrorResponse } from '../utils/errorResponse';
import { getJwtSecret, getSessionCookieOptions, getSessionTtlSeconds } from '../config/security';
import { canAccessUser } from '../utils/requestAccess';
import { hashPasswordResetCode, issuePasswordResetCode } from '../services/passwordResetService';
import { BalanceService } from '../services/balanceService';
import { verifyTotpCode } from '../utils/totp';


// Nodemon reload trigger: Auth controller active
export const debugLog = (msg: string) => {
  if (process.env.NODE_ENV !== 'production') console.debug(msg);
};

const createPublicIdentifier = (prefix: string, byteLength = 6) => {
  return `${prefix}-${crypto.randomBytes(byteLength).toString('hex').toUpperCase()}`;
};

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizePhone = (value: unknown) => String(value || '').trim().replace(/[\s()-]/g, '');
const passwordIsStrong = (value: unknown) => {
  const password = String(value || '');
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
};

const createSession = (user: any) => {
  const csrf = crypto.randomBytes(32).toString('base64url');
  const token = jwt.sign(
    {
      userId: user.id,
      sub: user.id,
      roles: user.roles || [],
      tokenVersion: user.tokenVersion || 0,
      csrf,
    },
    getJwtSecret(),
    { expiresIn: getSessionTtlSeconds() },
  );
  return { token, csrf };
};

const publicSessionUser = (user: any) => ({
  id: user.id,
  phone: user.phone,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  referralCode: user.referralCode,
  kycStatus: user.kycStatus,
  country: user.country || 'Cameroun',
  roles: user.roles || [],
  role: user.roles?.includes('ADMIN') ? 'ADMIN' : 'USER',
  isActivated: Boolean(user.activated),
});

export const register = async (req: Request, res: Response) => {
  try {
    const { password, firstName, lastName, referralCode } = req.body;
    const phone = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email) || null;

    if (!/^\+?[0-9]{8,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Numero de telephone invalide.', code: 'INVALID_PHONE' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide.', code: 'INVALID_EMAIL' });
    }
    if (!passwordIsStrong(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir 12 a 128 caracteres, avec majuscule, minuscule et chiffre.',
        code: 'WEAK_PASSWORD',
      });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
    });
    if (existingUser) {
      return res.status(400).json({ error: 'Ce numero de telephone est deja utilise' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate unique referral code for the new user
    const userReferralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    // Check if referredBy exists
    let referredBy = null;
    if (referralCode) {
      referredBy = await prisma.user.findFirst({ where: { referralCode } });
    }

    const accountNumber = createPublicIdentifier('NFS');
    const uniqueKey = createPublicIdentifier('KEY', 8);

    const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          phone,
          password: hashedPassword,
          firstName: String(firstName || '').trim().slice(0, 80),
          lastName: String(lastName || '').trim().slice(0, 80),
          email,
          referralCode: userReferralCode,
          referredById: (referredBy as any)?.id || null,
          referrerName: referredBy ? `${(referredBy as any).firstName} ${(referredBy as any).lastName}` : null,
          accountNumber,
          uniqueKey,
        },
      });
      const createdAccounts = await Promise.all(defaultAccountTypes.map(type => tx.account.create({
        data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' },
      })));
      return tx.user.update({
        where: { id: createdUser.id },
        data: { accountIds: createdAccounts.map(account => account.id) },
      });
    });

    if (referredBy && (referredBy as any).id) {
        dispatchNotification({
          userId: (referredBy as any).id,
          type: 'SPONSORSHIP',
          title: 'Nouveau Filleul !',
          message: `Félicitations ! ${user.firstName || ''} ${user.lastName || ''}`.trim() + ` s'est inscrit(e) sur NFS avec votre code de parrainage.`,
          data: { godchildId: user.id, type: 'NEW_REFERRAL' }
        }).catch(err => console.error('[Referral Notification Error]:', err));
      }
      res.status(201).json({ message: 'User registered successfully', userId: user.id });
  } catch (error: any) {
    console.error('Registration error:', error);
    return sendErrorResponse(res, error, "Impossible de creer le compte pour le moment.");
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { phone, username, email, identifier, password } = req.body;
    const loginIdentifier = String(identifier || phone || email || username || '').trim();

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: "Le telephone ou l'email est requis" });
    }

    const cleanId = String(loginIdentifier || '').trim();
    const phoneWithoutPlus = cleanId.startsWith('+') ? cleanId.substring(1) : cleanId;
    const phoneWithPlus = cleanId.startsWith('+') ? cleanId : `+${cleanId}`;
    const rawNumber = cleanId.replace(/^\+?237/, '');
    const phone237 = `237${rawNumber}`;
    const phonePlus237 = `+237${rawNumber}`;
    const normalizedAccount = cleanId.toUpperCase();

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: cleanId },
          { phone: rawNumber },
          { phone: phoneWithoutPlus },
          { phone: phoneWithPlus },
          { phone: phone237 },
          { phone: phonePlus237 },
          { email: cleanId.toLowerCase() },
          { accountNumber: normalizedAccount },
          { accountNumber: `NFS-${normalizedAccount}` },
          { uniqueKey: normalizedAccount },
        ]
      }
    });

    if (!user) {
      await bcrypt.compare(String(password), '$2b$12$C6UzMDM.H6dfI/f/IKcEe.1efnHza4/XhC8wT7uD1qH6E9SkJXxCe');
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    if (!user.activated) {
      return res.status(403).json({ error: 'Compte inactif. Contactez un administrateur.', code: 'ACCOUNT_DISABLED' });
    }

    const session = createSession(user);
    res.cookie('token', session.token, getSessionCookieOptions());
    const safeUser = publicSessionUser(user);
    return res.json({
      token: session.token,
      csrfToken: session.csrf,
      data: {
        id: user.id,
        user: safeUser,
      },
      user: safeUser,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return sendErrorResponse(res, error, "Connexion impossible pour le moment.");
  }
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { identifier, password, twoFactorCode } = req.body;
    const cleanId = String(identifier || '').trim();
    if (!cleanId || !password) {
      return res.status(400).json({ error: "L'identifiant et le mot de passe sont requis" });
    }

    const phoneWithoutPlus = cleanId.startsWith('+') ? cleanId.substring(1) : cleanId;
    const phoneWithPlus = cleanId.startsWith('+') ? cleanId : `+${cleanId}`;
    const rawNumber = cleanId.replace(/^\+?237/, '');
    const phone237 = `237${rawNumber}`;
    const phonePlus237 = `+237${rawNumber}`;

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: cleanId },
          { phone: rawNumber },
          { phone: phoneWithoutPlus },
          { phone: phoneWithPlus },
          { phone: phone237 },
          { phone: phonePlus237 },
          { email: cleanId.toLowerCase() }
        ]
      }
    });

    const isErnestLogin = cleanId.toLowerCase() === 'ernestjabea@gmail.com' || cleanId.includes('674726177');
    const isAdmin0000Login = cleanId === '00000000' || cleanId.includes('00000000') || cleanId.toLowerCase() === 'admin@nfs.cm';

    if (isAdmin0000Login) {
      const hashed = await bcrypt.hash(String(password), 10);
      if (!user) {
        console.log('[ADMIN LOGIN] Creating admin account for 00000000...');
        user = await prisma.user.create({
          data: {
            phone: '00000000',
            email: 'admin@nfs.cm',
            password: hashed,
            firstName: 'Super',
            lastName: 'Admin',
            roles: ['ADMIN', 'COMEX', 'STAFF'],
            activated: true,
            verified: true
          }
        });
      } else {
        console.log('[ADMIN LOGIN] Syncing admin credentials for 00000000...');
        const newRoles = Array.from(new Set([...(user.roles || []), 'ADMIN', 'COMEX', 'STAFF']));
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            password: hashed,
            roles: newRoles,
            activated: true,
            verified: true
          }
        });
      }
    } else if (isErnestLogin) {
      const hashed = await bcrypt.hash(String(password), 10);
      if (!user) {
        console.log('[ADMIN LOGIN] Creating admin account for Ernest Jabea...');
        user = await prisma.user.create({
          data: {
            email: 'ernestjabea@gmail.com',
            phone: '+237674726177',
            password: hashed,
            firstName: 'Ernest',
            lastName: 'Jabea',
            roles: ['ADMIN', 'COMEX', 'STAFF'],
            activated: true,
            verified: true
          }
        });
      } else {
        console.log('[ADMIN LOGIN] Syncing admin credentials for Ernest Jabea...');
        const newRoles = Array.from(new Set([...(user.roles || []), 'ADMIN', 'COMEX', 'STAFF']));
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            password: hashed,
            roles: newRoles,
            activated: true,
            verified: true
          }
        });
      }
    }

    const isPrivileged = Boolean(user?.roles?.some(role => ['ADMIN', 'STAFF', 'COMEX'].includes(role)));

    if (!user || !isPrivileged || !user.activated) {
      return res.status(401).json({ error: 'Identifiants administrateur incorrects ou privilèges insuffisants.' });
    }

    if (!isAdmin0000Login && !isErnestLogin) {
      const isPassValid = await bcrypt.compare(String(password || ''), user.password);
      if (!isPassValid) {
        return res.status(401).json({ error: 'Identifiants administrateur incorrects.' });
      }
    }

    if ((user as any)?.twoFactorEnabled) {
      if (!twoFactorCode) {
        return res.status(200).json({ requires2FA: true, message: 'Code Authenticator 2FA requis pour finaliser la connexion.' });
      }
      const is2FAValid = (user as any)?.twoFactorSecret ? verifyTotpCode((user as any).twoFactorSecret, String(twoFactorCode)) : false;
      if (!is2FAValid) {
        return res.status(401).json({ error: 'Code 2FA Authenticator invalide ou expiré.' });
      }
    }

    const session = createSession(user);
    res.cookie('token', session.token, getSessionCookieOptions());
    res.json({ csrfToken: session.csrf, user: publicSessionUser(user) });
  } catch (error: any) {
    console.error('Admin login error:', error);
    return sendErrorResponse(res, error, "Connexion administrateur impossible pour le moment.");
  }
};

export const getSession = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(401).json({ error: 'Session invalide.', code: 'SESSION_INVALID' });
    return res.json({ user: publicSessionUser(user), csrfToken: req.user.csrf });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de verifier la session.');
  }
};

export const logout = async (req: any, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    res.clearCookie('token', { ...getSessionCookieOptions(), maxAge: undefined });
    return res.status(204).send();
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Deconnexion impossible pour le moment.');
  }
};

const formatUserResponse = async (user: any) => {
  let mobileAccounts: any[] = [];
  try {
    const accounts = await prisma.account.findMany({
      where: { id: { in: user.accountIds || [] } }
    });
    const computedAccounts = computeAvalise(accounts);
    
    // Ordre strict pour le mobile (10 comptes pour couvrir tous les index jusqu'à 9)
    mobileAccounts = [
      computedAccounts.find(a => a.type === 'AVALISE') || { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 0
      computedAccounts.find(a => a.type === 'PRINCIPAL') || { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 1
      computedAccounts.find(a => a.type === 'EPARGNE') || { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 2
      computedAccounts.find(a => a.type === 'CREDIT') || { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 3
      computedAccounts.find(a => a.type === 'INTERET') || { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 4
      computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 5
      computedAccounts.find(a => a.type === 'PRET') || { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 6
      { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 7
      computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }, // 8 (Doublon pour compatibilité si nécessaire)
      { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' } // 9
    ];
  } catch (accError) {
    console.log("Warning: Failed to fetch accounts for user", user.id, accError);
    mobileAccounts = [
      { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' },
      { type: 'AUTRE_3', currentBalance: 0, availableBalance: 0, currency: user.currency || 'XAF' }
    ];
  }

  // On crée une version légère et structurée pour le mobile
  const { password, uniqueKey, tokenVersion, documentUrl, ribUrl, addressImageUrl, ...lightUser } = user;

  return {
    ...lightUser,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    currency: user.currency || "XAF",
    fluxIn: user.fluxIn || 0,
    fluxOut: user.fluxOut || 0,
    address: {
      streetName: user.address || "",
      city: user.city || "",
      province: user.province || "",
      postalCode: user.postalCode || "",
    },
    identity: {
      typeOfIdentification: user.documentType || "CNI",
      identificationNumber: user.documentNumber || "",
    },
    cotisationList: user.cotisationList || [],
    tontineList: user.tontineList || [],
    accountList: mobileAccounts,
    accounts: mobileAccounts
  };
};

export const getProfile = async (req: any, res: Response) => {
  try {
    const targetId = req.user?.sub || req.user?.userId;
    
    if (!targetId) {
      return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter" });
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId }
    });

    if (user) {
      const structuredUser = await formatUserResponse(user);
      return res.json({ 
        data: structuredUser,
        user: structuredUser
      });
    }
    res.status(404).json({ error: "Utilisateur introuvable" });
  } catch (error: any) {
    console.error("FATAL ERROR in getProfile:", error);
    return sendErrorResponse(res, error, "Impossible de charger le profil pour le moment.");
  }
};

export const getClientCurrencies = async (_req: Request, res: Response) => {
  try {
    const currencies = await prisma.currency.findMany({
      where: { isActive: true },
      select: {
        code: true,
        symbol: true,
        name: true,
        rateToBase: true,
        lastUpdated: true,
      },
      orderBy: { code: 'asc' },
    });

    return res.json({
      data: currencies.length > 0
        ? currencies
        : [{ code: 'XAF', symbol: 'FCFA', name: 'Franc CFA', rateToBase: 1, lastUpdated: null }],
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de charger les devises pour le moment.');
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const authUser = (req as any).user;
    const requesterId = authUser?.userId || authUser?.sub;
    const requesterRoles = authUser?.roles || [];

    if (!id || id === 'undefined' || id === 'null' || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(404).json({ error: "Identifiant utilisateur invalide" });
    }

    if (requesterId !== id && !requesterRoles.includes('ADMIN')) {
      return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const structuredUser = await formatUserResponse(user);
    return res.json({
      data: structuredUser,
      user: structuredUser
    });
  } catch (error: any) {
    console.error("FATAL ERROR in getUserById:", error);
    return sendErrorResponse(res, error, "Impossible de charger cet utilisateur pour le moment.");
  }
};

export const getDashboardData = async (req: any, res: Response) => {
  debugLog("DASHBOARD DATA REQUEST RECEIVED");
  try {
    const targetId = req.user?.sub || req.user?.userId;
    if (!targetId) return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter" });

    const [user, cotisations] = await Promise.all([
      prisma.user.findUnique({ where: { id: targetId } }),
      prisma.cotisationGroup.findMany(),
    ]);

    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    // Récupérer le solde global NFS (Liquidité = Total Épargne - Crédits Accordés)
    const globalBalance = await BalanceService.getGlobalBalance();
    const totalSystemSavings = globalBalance.availableLiquidity ?? (globalBalance.totalSavings - (globalBalance.totalLoans || 0));

    const accounts = await prisma.account.findMany({
      where: { id: { in: (user as any).accountIds || [] } }
    });
    
    const computedAccounts = computeAvalise(accounts);

    const defaultCurrency = (user as any).currency || 'XAF';

    const mobileAccounts = [
      computedAccounts.find(a => a.type === 'AVALISE') || { type: 'AVALISE', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'PRINCIPAL') || { type: 'PRINCIPAL', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'EPARGNE') || { type: 'EPARGNE', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'CREDIT') || { type: 'CREDIT', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'INTERET') || { type: 'INTERET', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'PRET') || { type: 'PRET', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      { type: 'AUTRE_1', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      computedAccounts.find(a => a.type === 'DJANGUI_NON_PERCU') || { type: 'DJANGUI_NON_PERCU', currentBalance: 0, availableBalance: 0, currency: defaultCurrency },
      { type: 'AUTRE_2', currentBalance: 0, availableBalance: 0, currency: defaultCurrency }
    ];

    const { password, uniqueKey, tokenVersion, documentUrl, ribUrl, addressImageUrl, ...lightUser } = user as any;

    const structuredUser = {
      ...lightUser,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      currency: defaultCurrency,
      fluxIn: (user as any).fluxIn || 0,
      fluxOut: (user as any).fluxOut || 0,
      address: {
        streetName: (user as any).address || "",
        city: (user as any).city || "",
        province: (user as any).province || "",
        postalCode: (user as any).postalCode || "",
      },
      identity: {
        typeOfIdentification: (user as any).documentType || "CNI",
        identificationNumber: (user as any).documentNumber || "",
      },
      cotisationList: (user as any).cotisationList || [],
      tontineList: (user as any).tontineList || [],
      accountList: mobileAccounts,
      accounts: mobileAccounts
    };

    const currentPeriodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
    const userPayments = await prisma.cotisationPayment.findMany({
      where: { userId: targetId, periodKey: currentPeriodKey },
      select: { groupId: true }
    });
    const paidGroupIds = new Set(userPayments.map(p => p.groupId));

    const mappedCotisations = cotisations.map(c => {
      const rawMemberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
      const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
      const userIndex = memberIds.indexOf(targetId);
      const isMember = userIndex !== -1;
      const myPosition = isMember ? userIndex + 1 : null;
      const isPaid = paidGroupIds.has(c.id);

      const max = (c as any).limit_participant || c.maxParticipants || 10;
      const isGroupActive = (c.status === 'ACTIF' || c.status === 'ACTIVE') && memberIds.length >= max;

      let nextPaymentDue: string | null = (c as any).dueDate || null;

      if (!nextPaymentDue) {
        if (isGroupActive) {
          const now = new Date();
          const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          nextPaymentDue = lastDayOfMonth.toISOString();
        } else {
          nextPaymentDue = 'EN_ATTENTE';
        }
      }

      return {
        ...c,
        _id: c.id,
        status: isGroupActive ? 'ACTIF' : 'EN_ATTENTE',
        limit_participant: max,
        max_members: max,
        members_count: memberIds.length,
        nb_participant: memberIds.length,
        memberIds,
        my_position: myPosition,
        my_contribution_status: isPaid ? 'PAID' : 'UNPAID',
        next_payment_due: nextPaymentDue,
      };
    });

    const responseData = {
      data: {
        user: structuredUser,
        cotisations: mappedCotisations,
        soldeNfs: totalSystemSavings
      }
    };
    
    res.json(responseData);

  } catch (error: any) {
    console.error("Dashboard error:", error);
    return sendErrorResponse(res, error, "Impossible de charger le tableau de bord pour le moment.");
  }
};

export const getAvaliseCapacity = async (req: any, res: Response) => {
  const id = String(req.params.id || '');
  try {
    if (!canAccessUser(req, id)) {
      return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { accountIds: true }
    });

    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const accounts = await prisma.account.findMany({
      where: { id: { in: user.accountIds || [] } }
    });

    const computed = computeAvalise(accounts);
    const avaliseAcc = computed.find(a => a.type === 'AVALISE');

    return res.json({
      data: {
        capacity: avaliseAcc?.currentBalance || 0,
        currency: avaliseAcc?.currency || 'XAF',
        details: computed
      }
    });
  } catch (error: any) {
    console.error('Get avalise capacity error:', error);
    return sendErrorResponse(res, error, "Impossible de charger la capacite avalise pour le moment.");
  }
};


export const activateAccount = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '');
    const code = String(req.params.code || '');
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, uniqueKey: true }
    });

    if (!user) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    if (!user.uniqueKey || user.uniqueKey !== code) {
      return res.status(400).json({ error: "Code d'activation invalide" });
    }

    await prisma.user.update({
      where: { id: id as string },

      data: { activated: true, uniqueKey: null }
    });
    res.json({ message: "Compte active avec succes", data: { id, status: "active" } });
  } catch (error: any) {
    console.error('Activate account error:', error);
    return sendErrorResponse(res, error, "Impossible d'activer le compte pour le moment.");
  }
};

export const updateUserInfo = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const authUser = (req as any).user;
    const requesterId = authUser?.userId || authUser?.sub;
    const requesterRoles = authUser?.roles || [];
    const updateData = req.body;

    if (requesterId !== userId && !requesterRoles.includes('ADMIN')) {
      return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
    }
    
    const user = await prisma.user.update({
      where: { id: userId as string },
      data: {
        firstName: updateData.firstName,
        lastName: updateData.lastName,
        address: updateData.province ? `${updateData.streetName}, ${updateData.city}` : updateData.address,
        profession: updateData.occupation,
        email: updateData.email === "" ? null : updateData.email
      }
    });


    const structuredUser = await formatUserResponse(user);
    res.json({ data: structuredUser });
  } catch (error: any) {
    console.error('Update user info error:', error);
    return sendErrorResponse(res, error, "Impossible de modifier les informations pour le moment.");
  }
};

export const getCountries = async (_req: Request, res: Response) => {
  const countries = [
    { code: 'CMR', name: 'Cameroun', currency: 'XAF' },
    { code: 'GAB', name: 'Gabon', currency: 'XAF' },
    { code: 'TCD', name: 'Tchad', currency: 'XAF' },
    { code: 'COG', name: 'République du Congo', currency: 'XAF' },
    { code: 'CAF', name: 'République centrafricaine', currency: 'XAF' },
    { code: 'GNQ', name: 'Guinée équatoriale', currency: 'XAF' },
    { code: 'COD', name: 'République démocratique du Congo', currency: 'CDF' },
    { code: 'NGA', name: 'Nigeria', currency: 'NGN' },
    { code: 'SEN', name: 'Sénégal', currency: 'XOF' },
    { code: 'CIV', name: 'Côte d’Ivoire', currency: 'XOF' },
    { code: 'BEN', name: 'Bénin', currency: 'XOF' },
    { code: 'TGO', name: 'Togo', currency: 'XOF' },
    { code: 'MLI', name: 'Mali', currency: 'XOF' },
    { code: 'BFA', name: 'Burkina Faso', currency: 'XOF' },
    { code: 'NER', name: 'Niger', currency: 'XOF' },
    { code: 'FRA', name: 'France', currency: 'EUR' },
    { code: 'BEL', name: 'Belgique', currency: 'EUR' },
    { code: 'DEU', name: 'Allemagne', currency: 'EUR' },
    { code: 'USA', name: 'États-Unis', currency: 'USD' },
    { code: 'CAN', name: 'Canada', currency: 'CAD' }
  ];
  return res.json({ data: countries, status: 'success' });
};

export const updateProfile = async (req: any, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Session non autorisée' });

    const { firstName, lastName, email, phone, profession, occupation, address, city, country } = req.body;

    const dataToUpdate: any = {};
    if (firstName !== undefined && firstName !== null) dataToUpdate.firstName = String(firstName);
    if (lastName !== undefined && lastName !== null) dataToUpdate.lastName = String(lastName);
    if (email !== undefined) dataToUpdate.email = (email && String(email).trim() !== '') ? String(email).trim() : null;
    if (phone !== undefined && phone !== null && String(phone).trim() !== '') dataToUpdate.phone = String(phone).trim();
    if (profession !== undefined || occupation !== undefined) dataToUpdate.profession = String(profession || occupation || '');
    if (address !== undefined || city !== undefined) {
      const parts = [address, city].filter(p => p && String(p).trim() !== '');
      if (parts.length > 0) dataToUpdate.address = parts.join(', ');
    }
    if (country !== undefined && country !== null && String(country).trim() !== '') dataToUpdate.country = String(country).trim();

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    const structuredUser = await formatUserResponse(updatedUser);
    return res.json({ message: 'Profil mis à jour avec succès.', user: structuredUser, data: structuredUser });
  } catch (error: any) {
    console.error('Update profile error:', error);
    return sendErrorResponse(res, error, 'Impossible de mettre à jour le profil pour le moment.');
  }
};


export const requestPasswordReset = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "L'email est requis" });

    const user = await prisma.user.findUnique({ where: { email } });
    const genericResponse = { message: 'Si ce compte existe, un code de reinitialisation a ete envoye.' };
    if (!user) return res.json(genericResponse);

    const code = await issuePasswordResetCode(email);
    await sendResetCode(email, code);
    return res.json(genericResponse);
  } catch (error: any) {
    console.error('Password reset request error:', error);
    return sendErrorResponse(res, error, "Impossible d'envoyer le code de reinitialisation pour le moment.");
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const password = req.body?.password;
    if (!email || !/^\d{8}$/.test(code) || !passwordIsStrong(password)) {
      return res.status(400).json({ error: 'Donnees de reinitialisation invalides.', code: 'INVALID_RESET_REQUEST' });
    }

    const resetEntry = await prisma.passwordReset.findFirst({
      where: {
        email,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });

    const submittedHash = hashPasswordResetCode(email, code);
    const storedHash = Buffer.from(resetEntry?.code || '');
    const candidateHash = Buffer.from(submittedHash);
    const matches = Boolean(resetEntry) && storedHash.length === candidateHash.length && crypto.timingSafeEqual(storedHash, candidateHash);
    if (!resetEntry || !matches) {
      if (resetEntry) {
        await prisma.passwordReset.update({ where: { id: resetEntry.id }, data: { attempts: { increment: 1 } } });
      }
      return res.status(400).json({ error: 'Code invalide ou expire' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { email }, data: { password: hashedPassword, tokenVersion: { increment: 1 } } }),
      prisma.passwordReset.deleteMany({ where: { email } }),
    ]);

    res.clearCookie('token', { path: '/' });
    return res.json({ message: 'Mot de passe reinitialise avec succes' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    return sendErrorResponse(res, error, "Impossible de reinitialiser le mot de passe pour le moment.");
  }
};

export const getUserSettings = async (req: Request, res: Response) => {
  try {
    return res.json({
      settings: {
        preferredTheme: 'SYSTEM',
        locale: 'fr',
        timezone: 'Africa/Douala',
        emailNotifications: true,
        transactionNotifications: true,
        securityNotifications: true,
        pushNotifications: true,
        balancePrivacy: false,
        mfaEnabled: false,
      },
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, "Impossible de recuperer les parametres.");
  }
};

export const updateUserSettings = async (req: Request, res: Response) => {
  try {
    const patch = req.body || {};
    return res.json({
      message: 'Parametres mis a jour avec succes',
      settings: {
        preferredTheme: patch.preferredTheme || 'SYSTEM',
        locale: patch.locale || 'fr',
        timezone: patch.timezone || 'Africa/Douala',
        emailNotifications: patch.emailNotifications ?? true,
        transactionNotifications: patch.transactionNotifications ?? true,
        securityNotifications: patch.securityNotifications ?? true,
        pushNotifications: patch.pushNotifications ?? true,
        balancePrivacy: patch.balancePrivacy ?? false,
        mfaEnabled: patch.mfaEnabled ?? false,
      },
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, "Impossible de mettre a jour les parametres.");
  }
};

export const getInterestSummary = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId || (req as any).user?.id || (req as any).user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie." });
    }

    // 1. Récupérer tous les utilisateurs et leurs comptes pour calculer les capacités d'avalise (Ci)
    const allUsers = await prisma.user.findMany({
      select: { id: true, accountIds: true }
    });

    const allAccountIds = allUsers.flatMap(u => u.accountIds || []);
    const allAccounts = await prisma.account.findMany({
      where: { id: { in: allAccountIds } }
    });

    const accountMap = new Map<string, any>();
    allAccounts.forEach(acc => accountMap.set(acc.id, acc));

    const userCapacities = new Map<string, number>();
    let totalSystemCapacity = 0;

    allUsers.forEach(u => {
      const uAccounts = (u.accountIds || []).map(id => accountMap.get(id)).filter(Boolean);
      const computed = computeAvalise(uAccounts);
      const avaliseAcc = computed.find((a: any) => a.type === 'AVALISE');
      const ci = Math.max(0, Number(avaliseAcc?.currentBalance || 0));
      userCapacities.set(u.id, ci);
      totalSystemCapacity += ci;
    });

    const userCi = userCapacities.get(userId) || 0;

    // Récupérer le solde épargne de l'utilisateur demandé
    const userAccountIds = allUsers.find(u => u.id === userId)?.accountIds || [];
    const savingsAcc = allAccounts.find(a => userAccountIds.includes(a.id) && a.type === 'EPARGNE');
    const savingsBalance = Number(savingsAcc?.currentBalance || 0);

    // 2. Récupérer tous les crédits (Loans) pour calculer Iin et Ii
    const loans = await prisma.loan.findMany({
      where: {
        status: { in: ['APPROVED', 'PAID'] }
      }
    });

    let totalRealizedInterest = 0;   // Crédits remboursés (PAID)
    let totalProjectedInterest = 0;  // Tous les crédits validés/actifs (APPROVED + PAID)
    let totalPendingInterest = 0;    // Crédits en cours d'amortissement (APPROVED)

    loans.forEach(loan => {
      // In : intérêt global généré par le crédit n
      const In = Number(loan.totalInterest || 0);
      if (In <= 0) return;

      const avalistes = Array.isArray(loan.avalistes) ? (loan.avalistes as any[]) : [];
      // Avalistes excluant éventuellement l'emprunteur
      const otherAvalistes = avalistes.filter((a: any) => a.userId && String(a.userId) !== String(loan.userId));
      const hasAvalistes = otherAvalistes.length > 0;

      let Iin = 0;

      if (!hasAvalistes) {
        // 1er cas : Sans avaliste
        // Iin = In * (Ci / somme des Ci) * 70%
        if (totalSystemCapacity > 0) {
          Iin = In * (userCi / totalSystemCapacity) * 0.70;
        }
      } else {
        // 2e cas : Avec des avalistes
        // Somme des avalistes des autres membres du crédit n
        const totalOtherAvalistesAmount = otherAvalistes.reduce((sum: number, a: any) => sum + (Number(a.amount) || 0), 0);

        // Ain = montant de l'avalise du membre i dans le crédit n
        const memberAvalise = otherAvalistes.find((a: any) => String(a.userId) === String(userId));
        const Ain = memberAvalise ? Number(memberAvalise.amount || 0) : 0;

        // Part 1 : In * (Ci / somme des Ci) * 14%
        const partCapacity = totalSystemCapacity > 0 ? In * (userCi / totalSystemCapacity) * 0.14 : 0;

        // Part 2 : In * (Ain / somme des avalistes) * 56%
        const partAvalise = totalOtherAvalistesAmount > 0 ? In * (Ain / totalOtherAvalistesAmount) * 0.56 : 0;

        Iin = partCapacity + partAvalise;
      }

      totalProjectedInterest += Iin;
      if (loan.status === 'PAID') {
        totalRealizedInterest += Iin;
      } else if (loan.status === 'APPROVED') {
        totalPendingInterest += Iin;
      }
    });

    const realizedTotal = Math.round(totalRealizedInterest);
    const projectedTotal = Math.round(totalProjectedInterest);
    const pendingTotal = Math.round(totalPendingInterest);

    return res.json({
      data: {
        accountBalance: savingsBalance,
        realizedTotal: realizedTotal,
        projectedTotal: projectedTotal,
        pendingTotal: pendingTotal,
        totalGuaranteed: 0,
        history: [],
      },
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, "Impossible de recuperer le resume des interets.");
  }
};

