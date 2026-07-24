import { Router, Request, Response } from 'express';

const router = Router();

router.get('/unread-count', (_req: Request, res: Response) => {
  return res.json({ unread: 0 });
});

router.get('/', (_req: Request, res: Response) => {
  return res.json({ data: [], unread: 0, total: 0 });
});

router.patch('/read-all', (_req: Request, res: Response) => {
  return res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
});

router.patch('/:id/read', (_req: Request, res: Response) => {
  return res.json({ message: 'Notification marquée comme lue.' });
});

router.get('/push/public-key', (_req: Request, res: Response) => {
  return res.json({ publicKey: '' });
});

router.post('/push/subscriptions', (_req: Request, res: Response) => {
  return res.json({ message: 'Abonnement push enregistré.' });
});

router.delete('/push/subscriptions', (_req: Request, res: Response) => {
  return res.json({ message: 'Abonnement push supprimé.' });
});

export default router;
