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
import paymentRoutes from './routes/paymentRoutes';
import { getCreditsPublic } from './controllers/transactionController';
import { setupSwagger } from './utils/swaggerConfig';
import { initCurrencyJob } from './services/currencyService';
import { sendErrorResponse } from './utils/errorResponse';
import { isAllowedCorsOrigin, validateSecurityConfiguration } from './config/security';
import { sanitizeJsonResponses } from './middlewares/responseSanitizer';
import { verifyStripeWebhookEvent, processStripeCheckoutCompleted } from './services/stripeService';

import bcrypt from 'bcryptjs';
import prisma from './utils/prisma';
import { execSync } from 'child_process';
import path from 'path';

if (process.env.PRISMA_AUTO_GENERATE === 'true') {
  try {
    const prismaCliPath = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
    console.log('[PRISMA AUTO-GENERATE] Updating Prisma Client...');
    execSync(`"${process.execPath}" "${prismaCliPath}" generate`, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    console.log('[PRISMA AUTO-GENERATE] Prisma Client generated successfully!');
  } catch (e: any) {
    console.warn('[PRISMA AUTO-GENERATE SKIPPED]: Engine binary locked or already up-to-date.');
  }
}

const app = express();
const PORT = process.env.PORT || 5000;
validateSecurityConfiguration();

async function ensureAdminAccountsOnStartup() {
  try {
    // 1. Super Admin 00000000
    const hash0 = await bcrypt.hash('adminpassword', 10);
    const existing0 = await prisma.user.findFirst({
      where: { OR: [{ phone: '00000000' }, { email: 'admin@nfs.cm' }] }
    });
    if (!existing0) {
      await prisma.user.create({
        data: {
          phone: '00000000',
          email: 'admin@nfs.cm',
          password: hash0,
          firstName: 'Super',
          lastName: 'Admin',
          roles: ['ADMIN', 'COMEX', 'STAFF'],
          activated: true,
          verified: true
        }
      });
    } else {
      await prisma.user.update({
        where: { id: existing0.id },
        data: {
          password: hash0,
          roles: ['ADMIN', 'COMEX', 'STAFF'],
          activated: true,
          verified: true
        }
      });
    }

    // 2. Ernest Jabea
    const hashErnest = await bcrypt.hash('64646073', 10);
    const existingErnest = await prisma.user.findFirst({
      where: { OR: [{ email: 'ernestjabea@gmail.com' }, { phone: '+237674726177' }, { phone: '674726177' }] }
    });
    if (!existingErnest) {
      await prisma.user.create({
        data: {
          email: 'ernestjabea@gmail.com',
          phone: '+237674726177',
          password: hashErnest,
          firstName: 'Ernest',
          lastName: 'Jabea',
          roles: ['ADMIN', 'COMEX', 'STAFF'],
          activated: true,
          verified: true
        }
      });
    } else {
      await prisma.user.update({
        where: { id: existingErnest.id },
        data: {
          password: hashErnest,
          roles: ['ADMIN', 'COMEX', 'STAFF'],
          activated: true,
          verified: true
        }
      });
    }
    console.log('✅ [DATABASE SYNC] Admin accounts (00000000 & ernestjabea@gmail.com) verified and active.');
  } catch (err: any) {
    console.error('⚠️ [DATABASE SYNC ERROR]:', err?.message || err);
  }
}

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Idempotency-Key', 'Stripe-Signature'],
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

// Raw body parser for Stripe Webhook before express.json
app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).send('En-tête Stripe-Signature manquant.');
  }

  let event: any;
  try {
    event = verifyStripeWebhookEvent(req.body, sig as string);
  } catch (err: any) {
    console.error(`[Stripe Webhook Signature Error]: ${err.message}`);
    return res.status(400).send(`Signature Webhook invalide : ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await processStripeCheckoutCompleted(session);
    }
    return res.json({ received: true });
  } catch (err: any) {
    console.error(`[Stripe Webhook Processing Error]: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

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
app.use('/api/payments', paymentRoutes);

// Mobile Compatibility Aliases
app.get('/api/credits', getCreditsPublic);
app.use('/public/v1', authRoutes);
app.use('/secured/v1', authRoutes);

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

import { startEnkapReconciliationCron } from './cron/enkapReconciliationCron';

const rawPort = process.env.PORT;
const isNumericPort = rawPort && !isNaN(Number(rawPort));
const PORT = isNumericPort ? Number(rawPort) : (rawPort || 5000);

startPenaltyCron();
startEnkapReconciliationCron(10);

if (typeof PORT === 'number') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    initCurrencyJob();
    ensureAdminAccountsOnStartup();
    console.log('NFS Backend fully reloaded and active.');
  });
} else {
  app.listen(PORT, () => {
    console.log(`Server is listening on Passenger socket: ${PORT}`);
    initCurrencyJob();
    ensureAdminAccountsOnStartup();
    console.log('NFS Backend fully reloaded and active.');
  });
}


