"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSecurityConfiguration = exports.isAllowedCorsOrigin = exports.getAllowedOrigins = exports.getSessionCookieOptions = exports.getSessionTtlSeconds = exports.getOtpHmacSecret = exports.getJwtSecret = exports.isProduction = void 0;
const DEFAULT_DEV_JWT_SECRET = 'dev-only-nfs-secret-change-me-32-chars-min';
const DEFAULT_DEV_OTP_SECRET = 'dev-only-nfs-otp-secret-change-me-32-chars';
exports.isProduction = process.env.NODE_ENV === 'production';
const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'supersecret' || secret.length < 32) {
        if (exports.isProduction) {
            throw new Error('JWT_SECRET must be set to a strong value of at least 32 characters in production.');
        }
        return DEFAULT_DEV_JWT_SECRET;
    }
    return secret;
};
exports.getJwtSecret = getJwtSecret;
const getOtpHmacSecret = () => {
    const secret = process.env.OTP_HMAC_SECRET;
    if (!secret || secret.length < 32) {
        if (exports.isProduction) {
            throw new Error('OTP_HMAC_SECRET must contain at least 32 characters in production.');
        }
        return DEFAULT_DEV_OTP_SECRET;
    }
    return secret;
};
exports.getOtpHmacSecret = getOtpHmacSecret;
const getSessionTtlSeconds = () => {
    const configured = Number(process.env.SESSION_TTL_SECONDS || 7200);
    return Number.isFinite(configured) && configured >= 300 && configured <= 86400 ? configured : 7200;
};
exports.getSessionTtlSeconds = getSessionTtlSeconds;
const getSessionCookieOptions = () => ({
    httpOnly: true,
    secure: exports.isProduction,
    sameSite: exports.isProduction ? 'strict' : 'lax',
    path: '/',
    maxAge: (0, exports.getSessionTtlSeconds)() * 1000,
});
exports.getSessionCookieOptions = getSessionCookieOptions;
const getAllowedOrigins = () => {
    const configuredOrigins = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    const productionOrigins = [
        'https://nfs.ejabbing.com',
        'https://www.nfs.ejabbing.com',
        'https://app.nfs.ejabbing.com',
        'https://www.app.nfs.ejabbing.com',
    ];
    const developmentOrigins = [
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:5176',
        'http://localhost:8090',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        'http://127.0.0.1:5176',
        'http://127.0.0.1:8090',
    ];
    return new Set([
        ...productionOrigins,
        ...(exports.isProduction ? [] : developmentOrigins),
        ...configuredOrigins,
    ]);
};
exports.getAllowedOrigins = getAllowedOrigins;
const isAllowedCorsOrigin = (origin) => {
    if (!origin)
        return true;
    if ((0, exports.getAllowedOrigins)().has(origin))
        return true;
    if (!exports.isProduction) {
        // Permettre l'accès depuis le réseau Wi-Fi / LAN local sur mobile
        return /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):\d+$/i.test(origin);
    }
    return false;
};
exports.isAllowedCorsOrigin = isAllowedCorsOrigin;
const validateSecurityConfiguration = () => {
    (0, exports.getJwtSecret)();
    (0, exports.getOtpHmacSecret)();
    if (exports.isProduction) {
        for (const origin of (0, exports.getAllowedOrigins)()) {
            if (!origin.startsWith('https://')) {
                throw new Error(`Production CORS origin must use HTTPS: ${origin}`);
            }
        }
    }
};
exports.validateSecurityConfiguration = validateSecurityConfiguration;
