import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { computeAvalise } from '../utils/computeAvalise';
import { sendResetCode } from '../services/mailService';
import { sendErrorResponse } from '../utils/errorResponse';


import fs from 'fs';
import path from 'path';

const logFile = path.join(__dirname, '../../debug_logs.txt');
export const debugLog = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(msg);
};

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

export const register = async (req: Request, res: Response) => {
  try {
    const { phone, password, firstName, lastName, email, referralCode } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(400).json({ error: 'Ce numero de telephone est deja utilise' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate unique referral code for the new user
    const userReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Check if referredBy exists
    let referredBy = null;
    if (referralCode) {
      referredBy = await prisma.user.findFirst({ where: { referralCode } });
    }

    const accountNumber = "NFS-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const uniqueKey = "KEY-" + Math.random().toString(36).substring(2, 12).toUpperCase();

    // Create user
    const user = await prisma.user.create({
      data: {
        phone,
        password: hashedPassword,
        firstName,
        lastName,
        email,
        referralCode: userReferralCode,
        referredById: (referredBy as any)?.id || null,
        referrerName: referredBy ? `${(referredBy as any).firstName} ${(referredBy as any).lastName}` : null,
        accountNumber,
        uniqueKey
      },
    });

    // Create default accounts
    const defaultAccountTypes = ['PRINCIPAL', 'CAUTION', 'EPARGNE', 'CREDIT', 'PRET', 'CREDIT_AVALISE', 'PARRAINAGE', 'AVALISE', 'DJANGUI_NON_PERCU', 'DJANGUI_PERCU'];
    const createdAccounts = await Promise.all(defaultAccountTypes.map(type => 
      prisma.account.create({
        data: { type, currentBalance: 0, availableBalance: 0, currency: 'XAF' }
      })
    ));

    const accountIds = createdAccounts.map(a => a.id);
    
    await prisma.user.update({
      where: { id: user.id },
      data: { accountIds }
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
    let loginIdentifier = identifier || phone || email || username;

    console.log(`[DEBUG] Login attempt for identifier: ${loginIdentifier}`);

    if (!loginIdentifier) {
      console.log(`[DEBUG] Login failed: Missing identifier`);
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
          { email: loginIdentifier }
        ]
      }
    });

    if (!user) {
      console.log(`[DEBUG] Login failed: User not found for ${loginIdentifier}`);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    console.log(`[DEBUG] User found: ${user.phone} / ${user.email} (ID: ${user.id}). Checking password...`);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log(`[DEBUG] Login failed: Invalid password for ${loginIdentifier}`);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }

    console.log(`[DEBUG] Login successful for ${user.email || user.phone}`);

    const isAdmin = user.roles.includes('ADMIN') || user.roles.includes('COMEX') || user.roles.includes('STAFF');
    const token = jwt.sign({ userId: user.id, role: isAdmin ? 'ADMIN' : 'USER' }, JWT_SECRET, { expiresIn: '7d' });

    if (process.env.NODE_ENV === 'production') {
      res.cookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
    }

    const responsePayload: any = {
      data: {
        id: user.id,
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          role: isAdmin ? 'ADMIN' : 'USER',
          isActivated: user.activated,
        }
      },
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: isAdmin ? 'ADMIN' : 'USER',
        isActivated: user.activated,
      },
    };

    if (process.env.NODE_ENV !== 'production') {
      responsePayload.token = token;
      responsePayload.data.access_token = token;
    }

    res.json(responsePayload);
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

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Identifiants administrateur incorrects' });
    }

    const token = jwt.sign({ sub: user.id, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '7d' });

    if (process.env.NODE_ENV === 'production') {
      res.cookie('token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      res.json({ user: { id: user.id, email: user.email, role: 'ADMIN' } });
    } else {
      res.json({ token, user: { id: user.id, email: user.email, role: 'ADMIN' } });
    }
  } catch (error: any) {
    console.error('Admin login error:', error);
    return sendErrorResponse(res, error, "Connexion administrateur impossible pour le moment.");
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
  const { documentUrl, ribUrl, addressImageUrl, ...lightUser } = user;

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
  console.log("GET PROFILE REQUEST for userId:", req.user?.sub, "type:", typeof req.user?.sub);
  try {
    const targetId = req.user?.sub || req.user?.userId;
    console.log("Looking for user with ID:", targetId);
    
    if (!targetId) {
      return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter" });
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId }
    });

    if (user) {
      console.log("User found:", user.id);
      const structuredUser = await formatUserResponse(user);
      return res.json({ 
        data: structuredUser,
        user: structuredUser
      });
    }
    console.log("User NOT found in database for ID:", req.user?.sub);
    res.status(404).json({ error: "Utilisateur introuvable" });
  } catch (error: any) {
    console.error("FATAL ERROR in getProfile:", error);
    return sendErrorResponse(res, error, "Impossible de charger le profil pour le moment.");
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    console.log("GET USER BY ID REQUEST for:", id);

    if (!id || id === 'undefined' || id === 'null' || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(404).json({ error: "Identifiant utilisateur invalide" });
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      console.log("User NOT found in database for ID:", id);
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
    
    debugLog(`DEBUG: Found ${accounts.length} accounts for Ernest`);
    accounts.forEach(a => debugLog(`DEBUG: Account ${a.type} = ${a.currentBalance}`));

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

    const { documentUrl, ribUrl, addressImageUrl, ...lightUser } = user as any;

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
    
    debugLog("SENDING DASHBOARD DATA: " + JSON.stringify({
      principal: (structuredUser as any).accountList[1].currentBalance,
      epargne: (structuredUser as any).accountList[2].currentBalance,
      soldeNfs: responseData.data.soldeNfs
    }));

    res.json(responseData);

  } catch (error: any) {
    console.error("Dashboard error:", error);
    return sendErrorResponse(res, error, "Impossible de charger le tableau de bord pour le moment.");
  }
};

export const getAvaliseCapacity = async (req: any, res: Response) => {
  const { id } = req.params;
  try {
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
    const { id, code } = req.params;
    // Mocking account activation
    await prisma.user.update({
      where: { id: id as string },

      data: { activated: true }
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
    const updateData = req.body;
    
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


    res.json({ data: user });
  } catch (error: any) {
    console.error('Update user info error:', error);
    return sendErrorResponse(res, error, "Impossible de modifier les informations pour le moment.");
  }
};


export const requestPasswordReset = async (req: Request, res: Response) => {
  try {
    const { email } = req.query;
    console.log(`[DEBUG] Step 1: Received request for ${email}`);
    if (!email) return res.status(400).json({ error: "L'email est requis" });

    console.log(`[DEBUG] Step 2: Looking up user in DB...`);
    const user = await prisma.user.findFirst({ where: { email: email as string } });
    console.log(`[DEBUG] Step 3: User lookup finished. Found user: ${user ? 'Yes' : 'No'}`);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    console.log(`[DEBUG] Step 4: Creating reset record in DB...`);
    await (prisma as any).passwordReset.create({
      data: {
        email: email as string,
        code,
        expiresAt,
      },
    });
    console.log(`[DEBUG] Step 5: Reset record created.`);

    console.log(`[DEBUG] Step 6: Sending email to ${email}...`);
    await sendResetCode(email as string, code);
    console.log(`[DEBUG] Step 7: Email sent.`);

    res.json({ message: 'Code de reinitialisation envoye avec succes' });


  } catch (error: any) {
    console.error('Password reset request error:', error);
    return sendErrorResponse(res, error, "Impossible d'envoyer le code de reinitialisation pour le moment.");
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, code, password } = req.body;
    console.log(`[DEBUG] Attempting password reset for: ${email} with code: ${code}`);


    const resetEntry = await (prisma as any).passwordReset.findFirst({
      where: {
        email,
        code,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!resetEntry) {
      return res.status(400).json({ error: 'Code invalide ou expire' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { email: email as string },
      data: { password: hashedPassword },
    });

    console.log(`[DEBUG] Password updated successfully for ${email}`);

    // Clean up
    await (prisma as any).passwordReset.deleteMany({ where: { email } });


    res.json({ message: 'Mot de passe reinitialise avec succes' });
  } catch (error: any) {
    console.error('Reset password error:', error);
    return sendErrorResponse(res, error, "Impossible de reinitialiser le mot de passe pour le moment.");
  }
};
