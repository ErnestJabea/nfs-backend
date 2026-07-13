const DEFAULT_DEV_JWT_SECRET = 'dev-only-nfs-secret-change-me-32-chars-min';

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

export const getAllowedOrigins = () => {
  const configuredOrigins = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  const defaultOrigins = [
    'https://nfs.ejabbing.com',
    'https://www.nfs.ejabbing.com',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ];

  return new Set([...defaultOrigins, ...configuredOrigins]);
};

export const isAllowedCorsOrigin = (origin?: string) => {
  if (!origin) return true;
  return getAllowedOrigins().has(origin);
};

