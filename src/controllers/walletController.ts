import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { computeAvalise } from '../utils/computeAvalise';

export const getWallets = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });
    if (!user) return res.json([]);
    const accounts = await prisma.account.findMany({
      where: { id: { in: user.accountIds || [] } }
    });
    const computedAccounts = computeAvalise(accounts);
    res.json(computedAccounts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const transfer = async (req: any, res: Response) => {
  res.status(501).json({ error: 'Fonctionnalité en cours de migration pour la base réelle' });
};

export const getTransactions = async (req: any, res: Response) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: req.user.userId,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(transactions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
