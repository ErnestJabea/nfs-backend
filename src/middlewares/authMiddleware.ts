import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { getJwtSecret } from '../config/security';

const getTokenFromRequest = (req: any) => {
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : undefined;

  return req.cookies?.token || bearerToken;
};

const normalizeDecodedUser = (decoded: any) => {
  const userId = decoded?.userId || decoded?.sub || decoded?.id;
  return {
    ...decoded,
    userId,
    sub: userId,
    roles: Array.isArray(decoded?.roles) ? decoded.roles : decoded?.role ? [decoded.role] : [],
  };
};

export const authMiddleware = async (req: any, res: Response, next: NextFunction) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Session expiree. Veuillez vous reconnecter.', code: 'SESSION_EXPIRED' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const normalizedUser = normalizeDecodedUser(decoded);

    if (!normalizedUser.userId) {
      return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'SESSION_INVALID' });
    }

    const user = await prisma.user.findUnique({
      where: { id: normalizedUser.userId },
      select: { id: true, roles: true, activated: true, tokenVersion: true, userGroups: true },
    });

    if (!user || !user.activated) {
      res.clearCookie('token', { path: '/' });
      return res.status(403).json({ error: 'Compte inactif ou introuvable.', code: 'ACCOUNT_DISABLED' });
    }

    if (Number(normalizedUser.tokenVersion || 0) !== user.tokenVersion) {
      res.clearCookie('token', { path: '/' });
      return res.status(401).json({ error: 'Session revoquee. Veuillez vous reconnecter.', code: 'SESSION_REVOKED' });
    }

    const usesCookieSession = Boolean(req.cookies?.token);
    const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (usesCookieSession && unsafeMethod) {
      const csrfHeader = req.get('X-CSRF-Token');
      if (!normalizedUser.csrf || !csrfHeader || csrfHeader !== normalizedUser.csrf) {
        return res.status(403).json({ error: 'Jeton CSRF manquant ou invalide.', code: 'CSRF_INVALID' });
      }
    }

    req.user = {
      ...normalizedUser,
      roles: user.roles || [],
      userGroups: user.userGroups || [],
      tokenVersion: user.tokenVersion,
    };
    next();
  } catch (error) {
    res.clearCookie('token', { path: '/' });
    return res.status(401).json({ error: 'Session expiree. Veuillez vous reconnecter.', code: 'SESSION_EXPIRED' });
  }
};

export const adminMiddleware = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'SESSION_INVALID' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true, activated: true, userGroups: true }
    });

    if (!user || !user.activated) {
      return res.status(403).json({ error: 'Compte administrateur inactif ou introuvable.', code: 'ACCOUNT_DISABLED' });
    }

    if (!user.roles?.includes('ADMIN')) {
      return res.status(403).json({ error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' });
    }

    req.user.roles = user.roles || [];
    req.user.userGroups = user.userGroups || [];
    next();
  } catch (error) {
    console.error('adminMiddleware error:', error);
    return res.status(500).json({ error: 'Verification des droits impossible pour le moment.' });
  }
};
