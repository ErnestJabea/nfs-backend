import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { startPenaltyCron } from './cron/penaltyCron';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/authRoutes';
import walletRoutes from './routes/walletRoutes';
import adminRoutes from './routes/adminRoutes';
import transactionIntentRoutes from './routes/transactionIntentRoutes';
import notificationRoutes from './routes/notificationRoutes';
import { setupSwagger } from './utils/swaggerConfig';
import { initCurrencyJob } from './services/currencyService';
import { sendErrorResponse } from './utils/errorResponse';
import { isAllowedCorsOrigin, validateSecurityConfiguration } from './config/security';
import { sanitizeJsonResponses } from './middlewares/responseSanitizer';

const app = express();
const PORT = process.env.PORT || 5000;
validateSecurityConfiguration();

// Middlewares
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
const corsOptions: cors.CorsOptions = {
  origin: function (origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, origin || true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Idempotency-Key'],
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use((req: Request, res: Response, next: NextFunction) => {
  const unsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafeMethod && req.cookies?.token) {
    const origin = req.get('Origin');
    if (!origin || !isAllowedCorsOrigin(origin)) {
      return res.status(403).json({ error: 'Origine de requete non autorisee.', code: 'ORIGIN_NOT_ALLOWED' });
    }
  }
  next();
});
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ limit: process.env.URLENCODED_BODY_LIMIT || '256kb', extended: false }));
app.use(sanitizeJsonResponses);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/transaction-intents', transactionIntentRoutes);
app.use('/api/notifications', notificationRoutes);

// Mobile Compatibility Aliases
app.use('/public/v1', authRoutes); // Aliasing /public/v1/sign_in to /api/auth/login
app.use('/secured/v1', authRoutes); // Aliasing /secured/v1/users to /api/auth/profile

// Basic Route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to NFS App API' });
});

// Health Check Route
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupSwagger(app);

// Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  return sendErrorResponse(res, err);
});

startPenaltyCron();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Available at http://localhost:${PORT}`);
  initCurrencyJob();
});
