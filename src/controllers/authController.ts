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

    // Normalisation du numéro de téléphone (on retire le + s'il existe)
    const phoneWithoutPlus = loginIdentifier.startsWith('+') ? loginIdentifier.substring(1) : loginIdentifier;
    const phoneWithPlus = loginIdentifier.startsWith('+') ? loginIdentifier : `+${loginIdentifier}`;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: loginIdentifier },
          { phone: phoneWithoutPlus },
          { phone: phoneWithPlus },
          { email: loginIdentifier.toLowerCase() }
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
    const { identifier, password } = req.body;
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ phone: identifier }, { email: identifier }],
        roles: { has: 'ADMIN' }
      }
    });

    if (!user || !user.activated || !(await bcrypt.compare(String(password || ''), user.password))) {
      return res.status(401).json({ error: 'Identifiants administrateur incorrects' });
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

    const [user, cotisations, allUsers] = await Promise.all([
      prisma.user.findUnique({ where: { id: targetId } }),
      prisma.cotisationGroup.findMany(),
      prisma.user.findMany({ select: { accountIds: true } })
    ]);

    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    // Calculer le solde global de l'épargne pour soldeNfs
    const allAccountIds = allUsers.flatMap(u => u.accountIds || []);
    const epargneSum = await prisma.account.aggregate({
      where: { id: { in: allAccountIds }, type: 'EPARGNE' },
      _sum: { currentBalance: true }
    });
    const totalSystemSavings = epargneSum._sum.currentBalance || 0;

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

    const responseData = {
      data: {
        user: structuredUser,
        cotisations: cotisations.map(c => ({ ...c, _id: c.id })),
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
    let savingsBalance = 0;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { accountIds: true },
      });
      if (user?.accountIds && user.accountIds.length > 0) {
        const savingsAccount = await prisma.account.findFirst({
          where: {
            id: { in: user.accountIds },
            type: 'EPARGNE',
          },
        });
        if (savingsAccount) {
          savingsBalance = Number(savingsAccount.currentBalance || 0);
        }
      }
    }

    return res.json({
      data: {
        accountBalance: savingsBalance,
        realizedTotal: 0,
        projectedTotal: Math.round(savingsBalance * 0.035),
        pendingTotal: 0,
        totalGuaranteed: 0,
        history: [],
      },
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, "Impossible de recuperer le resume des interets.");
  }
};

