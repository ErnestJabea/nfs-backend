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

    const flutterwaveEnabled = String(process.env.FLW_PAYMENTS_ENABLED).toLowerCase() === 'true';
    const stripeEnabled = String(process.env.STRIPE_PAYMENTS_ENABLED).toLowerCase() === 'true';
    const paymentsEnabled = flutterwaveEnabled || stripeEnabled;
    const paymentReturnUrl = process.env.PAYMENT_RETURN_URL;
    if (paymentsEnabled && (!paymentReturnUrl || !paymentReturnUrl.startsWith('https://'))) {
      throw new Error('PAYMENT_RETURN_URL must be configured with HTTPS when payments are enabled.');
    }
    if (paymentsEnabled && String(process.env.PAYMENTS_ENVIRONMENT).toLowerCase() !== 'production') {
      throw new Error('PAYMENTS_ENVIRONMENT must be production when payment providers are enabled in production.');
    }
    if (flutterwaveEnabled) {
      if (!process.env.FLW_SECRET_KEY || !process.env.FLW_SECRET_HASH) {
        throw new Error('Flutterwave payments require FLW_SECRET_KEY and FLW_SECRET_HASH.');
      }
      if (/TEST|SANDBOX/i.test(process.env.FLW_SECRET_KEY)) {
        throw new Error('A Flutterwave sandbox key cannot be enabled in production.');
      }
    }
    if (stripeEnabled) {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Stripe payments require STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
      }
      if (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
        throw new Error('A Stripe test key cannot be enabled in production.');
      }
    }
  }
};
