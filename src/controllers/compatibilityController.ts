import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getCotisations = async (req: Request, res: Response) => {
  try {
    const cotisations = await prisma.tontineGroup.findMany();
    const mapped = cotisations.map(c => ({
      ...c,
      _id: c.id,
      limit_participant: (c as any).limit_participant || (c as any).maxParticipants || 10
    }));
    res.json({ data: mapped });
  } catch (error: any) {
    console.error('getCotisations error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};


export const getProviderByCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const accounts = [
      { id: "1", type: "PRINCIPAL", currentBalance: 150000, availableBalance: 150000, currency: "XAF" },
      { id: "2", type: "EPARGNE", currentBalance: 75000, availableBalance: 75000, currency: "XAF" }
    ];
    res.json({
      data: {
        id: "nfs-provider-id",
        name: "NFS",
        code: code,
        description: "National Financial System",
        isActive: true,
        accountList: accounts,
        accounts: accounts
      }
    });
  } catch (error: any) {
    console.error('getProviderByCode error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};


export const getPrincipalNfs = async (req: Request, res: Response) => {
  res.json({ data: "0" });
};
