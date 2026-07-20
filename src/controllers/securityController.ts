import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { sendErrorResponse } from '../utils/errorResponse';
import { assertSecurityOtpDeliveryConfigured, deliverSecurityOtp } from '../services/otpDeliveryService';
import { formatUserResponse, createSession, publicSessionUser } from './authController';
import { publicCountries, resolveCountry } from '../security/countries';
import { passwordPolicyError } from '../security/passwordPolicy';
import {
  confirmationOtpMatches,
  createOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  findRecoveryHash,
  generateConfirmationOtp,
  generateRecoveryCodes,
  generateTotpSecret,
  hashConfirmationOtp,
  hashRecoveryCode,
  verifyLoginMfaChallenge,
  verifyTotp,
} from '../security/mfaService';
import { getSessionCookieOptions } from '../config/security';

const requestUserId = (req: any) => String(req.user?.userId || req.user?.sub || '');

const consumeMfaCode = async (user: any, submittedCode: unknown) => {
  if (!user.mfaEnabled || !user.mfaSecretEncrypted) return false;

  const code = String(submittedCode || '').trim();
  const secret = decryptMfaSecret(user.mfaSecretEncrypted);
  const matchedStep = verifyTotp(secret, code);
  if (matchedStep !== null) {
    const consumed = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [
          { mfaLastUsedStep: null },
          { mfaLastUsedStep: { lt: matchedStep } },
        ],
      },
      data: { mfaLastUsedStep: matchedStep },
    });
    return consumed.count === 1;
  }

  const recoveryHash = findRecoveryHash(user.id, code, user.mfaRecoveryCodeHashes || []);
  if (!recoveryHash) return false;

  const consumed = await prisma.user.updateMany({
    where: { id: user.id, mfaRecoveryCodeHashes: { has: recoveryHash } },
    data: { mfaRecoveryCodeHashes: (user.mfaRecoveryCodeHashes || []).filter((hash: string) => hash !== recoveryHash) },
  });
  return consumed.count === 1;
};

export const listCountries = async (_req: Request, res: Response) => res.json({ data: publicCountries() });

export const updateOwnProfile = async (req: any, res: Response) => {
  try {
    const userId = requestUserId(req);
    const requestedUserId = String(req.params?.userId || '');
    if (requestedUserId && requestedUserId !== userId) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil.', code: 'PROFILE_ACCESS_DENIED' });
    }
    const immutable = ['email', 'phone', 'firstName', 'lastName', 'name'];
    if (immutable.some(field => Object.prototype.hasOwnProperty.call(req.body || {}, field))) {
      return res.status(400).json({
        error: 'Le nom, l’adresse email et le numéro de téléphone ne peuvent pas être modifiés depuis le profil.',
        code: 'IMMUTABLE_PROFILE_FIELDS',
      });
    }

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const data: any = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'profession')) {
      const profession = String(req.body.profession || '').trim();
      if (profession.length > 120) return res.status(400).json({ error: 'La profession est trop longue.' });
      data.profession = profession || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'address')) {
      const address = String(req.body.address || '').trim();
      if (address.length > 240) return res.status(400).json({ error: 'L’adresse est trop longue.' });
      data.address = address || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'averageIncome')) {
      const averageIncome = Number(req.body.averageIncome);
      if (!Number.isFinite(averageIncome) || averageIncome < 0 || averageIncome > 1_000_000_000_000) {
        return res.status(400).json({ error: 'Le revenu moyen est invalide.' });
      }
      data.averageIncome = averageIncome;
    }

    let kycRevalidationRequired = false;
    if (Object.prototype.hasOwnProperty.call(req.body, 'countryCode')) {
      const country = resolveCountry(req.body.countryCode);
      if (!country) return res.status(400).json({ error: 'Pays de résidence non pris en charge.', code: 'UNSUPPORTED_COUNTRY' });
      const currentCountry = resolveCountry(currentUser.countryCode || currentUser.country);
      if (country.code !== currentCountry?.code) {
        data.country = country.name;
        data.countryCode = country.code;
        data.kycStatus = 'PENDING';
        data.approvedAt = null;
        kycRevalidationRequired = true;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Aucune information modifiable n’a été fournie.' });
    }

    const updatedUser = await prisma.user.update({ where: { id: userId }, data });
    const structuredUser = await formatUserResponse(updatedUser);
    return res.json({
      user: structuredUser,
      data: structuredUser,
      kycRevalidationRequired,
      message: kycRevalidationRequired
        ? 'Profil mis à jour. Le changement de pays doit être revalidé par le KYC.'
        : 'Profil mis à jour.',
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de modifier le profil pour le moment.');
  }
};

export const getSettings = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: requestUserId(req) },
      select: {
        preferredTheme: true,
        locale: true,
        timezone: true,
        emailNotifications: true,
        transactionNotifications: true,
        securityNotifications: true,
        pushNotifications: true,
        balancePrivacy: true,
        mfaEnabled: true,
        mfaVerifiedAt: true,
        mfaRecoveryCodeHashes: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({
      settings: {
        preferredTheme: user.preferredTheme,
        locale: user.locale,
        timezone: user.timezone,
        emailNotifications: user.emailNotifications,
        transactionNotifications: true,
        securityNotifications: true,
        pushNotifications: user.pushNotifications,
        balancePrivacy: user.balancePrivacy,
        mfaEnabled: user.mfaEnabled,
        mfaVerifiedAt: user.mfaVerifiedAt,
        recoveryCodesRemaining: user.mfaRecoveryCodeHashes.length,
      },
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de charger les paramètres.');
  }
};

export const updateSettings = async (req: any, res: Response) => {
  try {
    const data: any = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'preferredTheme')) {
      const theme = String(req.body.preferredTheme || '').toUpperCase();
      if (!['LIGHT', 'DARK', 'SYSTEM'].includes(theme)) return res.status(400).json({ error: 'Thème invalide.' });
      data.preferredTheme = theme;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'locale')) {
      const locale = String(req.body.locale || '').toLowerCase();
      if (!['fr', 'en'].includes(locale)) return res.status(400).json({ error: 'Langue invalide.' });
      data.locale = locale;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'timezone')) {
      const timezone = String(req.body.timezone || '');
      try { new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(); } catch {
        return res.status(400).json({ error: 'Fuseau horaire invalide.' });
      }
      data.timezone = timezone;
    }
    for (const field of ['emailNotifications', 'pushNotifications', 'balancePrivacy']) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        if (typeof req.body[field] !== 'boolean') return res.status(400).json({ error: `Valeur invalide pour ${field}.` });
        data[field] = req.body[field];
      }
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Aucun paramètre modifiable fourni.' });

    await prisma.user.update({ where: { id: requestUserId(req) }, data });
    return getSettings(req, res);
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de modifier les paramètres.');
  }
};

export const startMfaEnrollment = async (req: any, res: Response) => {
  try {
    const deliveryMode = assertSecurityOtpDeliveryConfigured();
    const userId = requestUserId(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.password))) {
      return res.status(400).json({ error: 'Mot de passe incorrect.', code: 'INVALID_PASSWORD' });
    }
    if (user.mfaEnabled) return res.status(409).json({ error: 'La MFA est déjà activée.', code: 'MFA_ALREADY_ENABLED' });

    const confirmationCode = generateConfirmationOtp();
    const secret = generateTotpSecret();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const enrollmentData = {
      secretEncrypted: encryptMfaSecret(secret),
      confirmationOtpHash: hashConfirmationOtp(userId, confirmationCode),
      otpExpiresAt,
      expiresAt,
      attempts: 0,
      deliveryVerifiedAt: null,
      deliveryChannel: deliveryMode === 'development' ? 'development' : 'pending',
      deliveryDestination: deliveryMode === 'development' ? 'development' : 'pending',
    };

    const enrollment = await prisma.mfaEnrollment.upsert({
      where: { userId },
      create: {
        userId,
        ...enrollmentData,
      },
      update: enrollmentData,
    });

    try {
      const delivery = await deliverSecurityOtp({ phone: user.phone, email: user.email }, confirmationCode);
      if (deliveryMode === 'sms') {
        await prisma.mfaEnrollment.update({
          where: { id: enrollment.id },
          data: { deliveryChannel: delivery.channel, deliveryDestination: delivery.destination },
        });
      }
      return res.status(201).json({
        step: 'VERIFY_DELIVERY_OTP',
        expiresAt: otpExpiresAt,
        delivery: { channel: delivery.channel, destination: delivery.destination },
        ...(delivery.developmentOtp ? { developmentOtp: delivery.developmentOtp } : {}),
      });
    } catch (error) {
      await prisma.mfaEnrollment.deleteMany({ where: { userId } });
      throw error;
    }
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de démarrer l’activation MFA.');
  }
};

export const verifyMfaEnrollmentDelivery = async (req: any, res: Response) => {
  try {
    const userId = requestUserId(req);
    const enrollment = await prisma.mfaEnrollment.findUnique({ where: { userId } });
    if (!enrollment || enrollment.expiresAt <= new Date() || enrollment.otpExpiresAt <= new Date()) {
      return res.status(400).json({ error: 'Le processus d’activation a expiré.', code: 'MFA_ENROLLMENT_EXPIRED' });
    }
    if (enrollment.attempts >= 5) return res.status(429).json({ error: 'Trop de tentatives.', code: 'MFA_ENROLLMENT_LOCKED' });

    const code = String(req.body?.otp || '').trim();
    if (!/^\d{8}$/.test(code) || !confirmationOtpMatches(userId, code, enrollment.confirmationOtpHash)) {
      await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ error: 'Code de confirmation invalide.', code: 'INVALID_OTP' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const secret = decryptMfaSecret(enrollment.secretEncrypted);
    await prisma.mfaEnrollment.update({
      where: { id: enrollment.id },
      data: { deliveryVerifiedAt: new Date(), confirmationOtpHash: hashConfirmationOtp(userId, generateConfirmationOtp()) },
    });
    return res.json({
      step: 'SCAN_AUTHENTICATOR_QR',
      otpauthUri: createOtpAuthUri(secret, user.email || user.phone),
      manualKey: secret,
      compatibleApps: ['Google Authenticator', 'Microsoft Authenticator'],
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de confirmer le code OTP.');
  }
};

export const confirmMfaEnrollment = async (req: any, res: Response) => {
  try {
    const userId = requestUserId(req);
    const enrollment = await prisma.mfaEnrollment.findUnique({ where: { userId } });
    if (!enrollment || !enrollment.deliveryVerifiedAt || enrollment.expiresAt <= new Date()) {
      return res.status(400).json({ error: 'Le processus d’activation a expiré.', code: 'MFA_ENROLLMENT_EXPIRED' });
    }
    const secret = decryptMfaSecret(enrollment.secretEncrypted);
    if (verifyTotp(secret, req.body?.totp) === null) {
      return res.status(400).json({ error: 'Code Authenticator invalide.', code: 'INVALID_TOTP' });
    }

    const recoveryCodes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecretEncrypted: enrollment.secretEncrypted,
          mfaRecoveryCodeHashes: recoveryCodes.map(code => hashRecoveryCode(userId, code)),
          mfaVerifiedAt: new Date(),
          mfaLastUsedStep: null,
        },
      }),
      prisma.mfaEnrollment.delete({ where: { id: enrollment.id } }),
    ]);

    return res.json({
      message: 'Authentification multifacteur activée.',
      recoveryCodes,
      warning: 'Enregistrez ces codes maintenant. Ils ne seront plus affichés.',
    });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de finaliser l’activation MFA.');
  }
};

export const verifyLoginMfa = async (req: Request, res: Response) => {
  try {
    let challenge;
    try {
      challenge = verifyLoginMfaChallenge(String(req.body?.challengeToken || ''));
    } catch {
      return res.status(400).json({ error: 'Défi MFA invalide ou expiré.', code: 'MFA_CHALLENGE_EXPIRED' });
    }
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.activated || user.tokenVersion !== Number(challenge.tokenVersion)) {
      return res.status(400).json({ error: 'Défi MFA invalide ou expiré.', code: 'MFA_CHALLENGE_EXPIRED' });
    }
    if (!(await consumeMfaCode(user, req.body?.code))) {
      return res.status(400).json({ error: 'Code MFA invalide ou déjà utilisé.', code: 'INVALID_MFA_CODE' });
    }

    const session = createSession(user);
    res.cookie('token', session.token, getSessionCookieOptions());
    return res.json({ csrfToken: session.csrf, user: publicSessionUser(user) });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de confirmer la connexion MFA.');
  }
};

export const disableMfa = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: requestUserId(req) } });
    if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.password))) {
      return res.status(400).json({ error: 'Mot de passe incorrect.', code: 'INVALID_PASSWORD' });
    }
    if (!user.mfaEnabled) return res.status(409).json({ error: 'La MFA n’est pas activée.' });
    if (!(await consumeMfaCode(user, req.body?.code))) {
      return res.status(400).json({ error: 'Code MFA invalide ou déjà utilisé.', code: 'INVALID_MFA_CODE' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaRecoveryCodeHashes: [],
        mfaVerifiedAt: null,
        mfaLastUsedStep: null,
        tokenVersion: { increment: 1 },
      },
    });
    res.clearCookie('token', { ...getSessionCookieOptions(), maxAge: undefined });
    return res.json({ message: 'MFA désactivée. Toutes les sessions ont été révoquées.', sessionRevoked: true });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de désactiver la MFA.');
  }
};

export const changePassword = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: requestUserId(req) } });
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect.', code: 'INVALID_PASSWORD' });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent.' });
    }
    const policyError = passwordPolicyError(newPassword);
    if (policyError) return res.status(400).json({ error: policyError, code: 'WEAK_PASSWORD' });
    if (user.mfaEnabled && !(await consumeMfaCode(user, req.body?.mfaCode))) {
      return res.status(400).json({ error: 'Code MFA invalide ou déjà utilisé.', code: 'INVALID_MFA_CODE' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } },
    });
    res.clearCookie('token', { ...getSessionCookieOptions(), maxAge: undefined });
    return res.json({ message: 'Mot de passe modifié. Toutes les sessions ont été révoquées.', sessionRevoked: true });
  } catch (error: any) {
    return sendErrorResponse(res, error, 'Impossible de modifier le mot de passe.');
  }
};
