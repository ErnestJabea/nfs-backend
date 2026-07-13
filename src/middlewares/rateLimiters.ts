import rateLimit from 'express-rate-limit';

const tooManyRequests = {
  error: 'Trop de tentatives. Veuillez patienter quelques minutes avant de reessayer.',
  code: 'RATE_LIMITED',
};

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequests,
});

export const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PASSWORD_RESET_RATE_LIMIT || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequests,
});

