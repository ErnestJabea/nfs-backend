import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const mapTransaction = (t: any) => ({
  ...t,
  id: t.id,
  _id: t.id,
  user: t.userId,
  destinationAmount: t.amount || 0,
  originAmount: t.amount || 0,
  originCurrency: t.currency || "XAF",
  destinationCurrency: t.currency || "XAF",
  status: t.status || "PENDING",
  transactionRef: t.transactionRef || "",
  createdAt: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString(),
  operation: t.operation || {},
  beneficiary: t.beneficiary || null
});

export const getUserTransactions = async (req: any, res: Response) => {
  try {
    const userId = req.params.userId || req.query.userId || req.user?.sub || req.user?.userId;


    if (!userId) return res.status(400).json({ error: "User ID required" });

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ data: transactions.map(mapTransaction) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCreditListPending = async (req: Request, res: Response) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { 
        status: "PENDING",
        purpose: { contains: "CREDIT" }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ data: transactions.map(mapTransaction) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCumulCredit = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { status } = req.query; // PENDING or SUCCESS
    
    const transactions = await prisma.transaction.findMany({
      where: { 
        userId: userId as string,
        status: status as string || "SUCCESS",
        purpose: { contains: "CREDIT" }
      }
    });


    const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    res.json({ data: total.toString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const generateInvoice = async (req: Request, res: Response) => {
  // Mocking PDF response for now
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from("PDF Fake Content"));
};
