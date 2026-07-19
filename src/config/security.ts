const DEFAULT_DEV_JWT_SECRET = 'dev-only-nfs-secret-change-me-32-chars-min';
const DEFAULT_DEV_OTP_SECRET = 'dev-only-nfs-otp-secret-change-me-32-chars';

export const isProduction = process.env.NODE_ENV === 'production';

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret === 'supersecret' || secret.length < 32) {
    if (isProduction) {
      throw new Error('JWT_SECRET must be set to a strong value of at least 32 characters in production.');
    }

    return DEFAULT_DEV_JWT_SECRET;
  }

  return secret;
};

export const getOtpHmacSecret = () => {
  const secret = process.env.OTP_HMAC_SECRET;

  if (!secret || secret.length < 32) {
    if (isProduction) {
      throw new Error('OTP_HMAC_SECRET must contain at least 32 characters in production.');
    }
    return DEFAULT_DEV_OTP_SECRET;
  }

  return secret;
};

export const getSessionTtlSeconds = () => {
  const configured = Number(process.env.SESSION_TTL_SECONDS || 7200);
  return Number.isFinite(configured) && configured >= 300 && configured <= 86400 ? configured : 7200;
};

export const getSessionCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: getSessionTtlSeconds() * 1000,
});

export const getAllowedOrigins = () => {
  const configuredOrigins = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  const productionOrigins = [
    'https://nfs.ejabbing.com',
    'https://www.nfs.ejabbing.com',
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
    ...(isProduction ? [] : developmentOrigins),
    ...configuredOrigins,
  ]);
};

export const isAllowedCorsOrigin = (origin?: string) => {
  if (!origin) return true;
  return getAllowedOrigins().has(origin);
};

export const validateSecurityConfiguration = () => {
  getJwtSecret();
  getOtpHmacSecret();

  if (isProduction) {
    for (const origin of getAllowedOrigins()) {
      if (!origin.startsWith('https://')) {
        throw new Error(`Production CORS origin must use HTTPS: ${origin}`);
      }
    }
  }
};
