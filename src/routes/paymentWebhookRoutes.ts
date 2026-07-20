import express, { Router } from 'express';
import { handleFlutterwaveWebhook, handleStripeWebhook } from '../controllers/paymentController';

const router = Router();
const rawJson = express.raw({ type: 'application/json', limit: '256kb' });

router.post('/flutterwave', rawJson, handleFlutterwaveWebhook);
router.post('/stripe', rawJson, handleStripeWebhook);

export default router;
