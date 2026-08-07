"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../utils/prisma"));
const security_1 = require("../config/security");
const getTokenFromRequest = (req) => {
    var _a;
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;
    return ((_a = req.cookies) === null || _a === void 0 ? void 0 : _a.token) || bearerToken;
};
const normalizeDecodedUser = (decoded) => {
    const userId = (decoded === null || decoded === void 0 ? void 0 : decoded.userId) || (decoded === null || decoded === void 0 ? void 0 : decoded.sub) || (decoded === null || decoded === void 0 ? void 0 : decoded.id);
    return Object.assign(Object.assign({}, decoded), { userId, sub: userId, roles: Array.isArray(decoded === null || decoded === void 0 ? void 0 : decoded.roles) ? decoded.roles : (decoded === null || decoded === void 0 ? void 0 : decoded.role) ? [decoded.role] : [] });
};
const authMiddleware = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const token = getTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: 'Session expiree. Veuillez vous reconnecter.', code: 'SESSION_EXPIRED' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, (0, security_1.getJwtSecret)());
        const normalizedUser = normalizeDecodedUser(decoded);
        if (!normalizedUser.userId) {
            return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'SESSION_INVALID' });
        }
        const user = yield prisma_1.default.user.findUnique({
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
        const usesCookieSession = Boolean((_a = req.cookies) === null || _a === void 0 ? void 0 : _a.token);
        const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        if (usesCookieSession && unsafeMethod) {
            const csrfHeader = req.get('X-CSRF-Token');
            if (!normalizedUser.csrf || !csrfHeader || csrfHeader !== normalizedUser.csrf) {
                return res.status(403).json({ error: 'Jeton CSRF manquant ou invalide.', code: 'CSRF_INVALID' });
            }
        }
        req.user = Object.assign(Object.assign({}, normalizedUser), { roles: user.roles || [], userGroups: user.userGroups || [], tokenVersion: user.tokenVersion });
        next();
    }
    catch (error) {
        res.clearCookie('token', { path: '/' });
        return res.status(401).json({ error: 'Session expiree. Veuillez vous reconnecter.', code: 'SESSION_EXPIRED' });
    }
});
exports.authMiddleware = authMiddleware;
const adminMiddleware = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.sub);
        if (!userId) {
            return res.status(401).json({ error: 'Session invalide. Veuillez vous reconnecter.', code: 'SESSION_INVALID' });
        }
        const user = yield prisma_1.default.user.findUnique({
            where: { id: userId },
            select: { id: true, roles: true, activated: true, userGroups: true }
        });
        if (!user || !user.activated) {
            return res.status(403).json({ error: 'Compte administrateur inactif ou introuvable.', code: 'ACCOUNT_DISABLED' });
        }
        if (!((_c = user.roles) === null || _c === void 0 ? void 0 : _c.includes('ADMIN'))) {
            return res.status(403).json({ error: 'Acces reserve aux administrateurs.', code: 'ADMIN_REQUIRED' });
        }
        req.user.roles = user.roles || [];
        req.user.userGroups = user.userGroups || [];
        next();
    }
    catch (error) {
        console.error('adminMiddleware error:', error);
        return res.status(500).json({ error: 'Verification des droits impossible pour le moment.' });
    }
});
exports.adminMiddleware = adminMiddleware;
