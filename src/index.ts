import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { startPenaltyCron } from './cron/penaltyCron';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes';
import walletRoutes from './routes/walletRoutes';
import adminRoutes from './routes/adminRoutes';
import { setupSwagger } from './utils/swaggerConfig';
import { initCurrencyJob } from './services/currencyService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true
}));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/admin', adminRoutes);

// Mobile Compatibility Aliases
app.use('/public/v1', authRoutes); // Aliasing /public/v1/sign_in to /api/auth/login
app.use('/secured/v1', authRoutes); // Aliasing /secured/v1/users to /api/auth/profile

// Basic Route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to NFS App API' });
});

setupSwagger(app);

// Error Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

startPenaltyCron();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Available at http://localhost:${PORT}`);
  initCurrencyJob();
});
// trigger nodemon restart v3
