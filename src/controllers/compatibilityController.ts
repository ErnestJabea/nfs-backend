import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { canAccessUser, getRequestUserId, requestIsAdmin } from '../utils/requestAccess';

export const getCotisations = async (req: Request, res: Response) => {
  try {
    const cotisations = await prisma.cotisationGroup.findMany();
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


import { BalanceService } from '../services/balanceService';

export const getProviderByCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const globalBalance = await BalanceService.getGlobalBalance();

    const accounts = [
      { id: "1", type: "PRINCIPAL", currentBalance: globalBalance.totalPrincipal || 0, availableBalance: globalBalance.totalPrincipal || 0, currency: "XAF" },
      { id: "2", type: "EPARGNE", currentBalance: globalBalance.totalSavings || 0, availableBalance: globalBalance.totalSavings || 0, currency: "XAF" }
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

export const getCotisationUsers = async (req: Request, res: Response) => {
  try {
    const idCotisation = req.params.idCotisation as string;

    if (!idCotisation || !/^[0-9a-fA-F]{24}$/.test(idCotisation)) {
      return res.status(400).json({ error: "Invalid cotisation ID format" });
    }

    const group = await prisma.cotisationGroup.findUnique({
      where: { id: idCotisation },
      include: {
        members: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          }
        }
      }
    }) as any;

    if (!group) {
      return res.status(404).json({ error: "Cotisation group not found" });
    }

    const requesterId = getRequestUserId(req);
    if (!requesterId || (!requestIsAdmin(req) && !group.memberIds.includes(requesterId))) {
      return res.status(403).json({ error: 'Acces refuse aux membres de cette cotisation.' });
    }

    res.json({ data: group.members });
  } catch (error: any) {
    console.error('getCotisationUsers error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const assignCotisation = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const idCotisation = req.query.idCotisation as string;

    if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID format" });
    }
    if (!idCotisation || !/^[0-9a-fA-F]{24}$/.test(idCotisation)) {
      return res.status(400).json({ error: "Invalid cotisation ID format" });
    }

    if (!canAccessUser(req, userId)) {
      return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
    }

    // Add the user ID to the memberIds array and increment count
    const group = await prisma.cotisationGroup.update({
      where: { id: idCotisation },
      data: {
        memberIds: {
          push: userId
        },
        nb_participant: {
          increment: 1
        }
      }
    });

    res.json({ message: "Successfully assigned to cotisation", data: group });
  } catch (error: any) {
    console.error('assignCotisation error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
