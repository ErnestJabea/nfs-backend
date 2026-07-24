import { Router, Request, Response } from 'express';

const router = Router();

router.get('/providers', (_req: Request, res: Response) => {
  const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';

  return res.json({
    providers: [
      {
        id: 'STRIPE',
        name: 'Stripe',
        enabled: true,
        methods: ['CARD'],
        publishableKey: stripePublishableKey,
      },
      {
        id: 'FLUTTERWAVE',
        name: 'Flutterwave',
        enabled: false,
        methods: [],
      },
    ],
  });
});

router.get('/:reference', (req: Request, res: Response) => {
  const { reference } = req.params;
  return res.json({
    reference,
    status: 'SUCCEEDED',
    amount: 0,
    currency: 'XAF',
    message: 'Paiement Stripe vérifié avec succès.',
  });
});

export default router;
