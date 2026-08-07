import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { canAccessUser, getRequestUserId, requestIsAdmin } from '../utils/requestAccess';

export const getCotisations = async (req: Request, res: Response) => {
  try {
    const cotisations = await prisma.cotisationGroup.findMany();
    const mapped = cotisations.map(c => {
      const rawMemberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
      const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
      const max = (c as any).limit_participant || c.maxParticipants || 10;
      const isGroupActive = (c.status === 'ACTIF' || c.status === 'ACTIVE') && memberIds.length >= max;

      let nextPaymentDue: string | null = (c as any).dueDate || null;
      if (!nextPaymentDue) {
        if (isGroupActive) {
          const now = new Date();
          const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          nextPaymentDue = lastDayOfMonth.toISOString();
        } else {
          nextPaymentDue = 'EN_ATTENTE';
        }
      }

      return {
        ...c,
        _id: c.id,
        status: isGroupActive ? 'ACTIF' : 'EN_ATTENTE',
        limit_participant: max,
        max_members: max,
        members_count: memberIds.length,
        nb_participant: memberIds.length,
        memberIds,
        next_payment_due: nextPaymentDue,
      };
    });
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

    const currentGroup = await prisma.cotisationGroup.findUnique({ where: { id: idCotisation } });
    if (!currentGroup) {
      return res.status(404).json({ error: "Groupe de cotisation introuvable." });
    }

    const rawMemberIds = Array.isArray(currentGroup.memberIds) ? currentGroup.memberIds : [];
    const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
    const max = currentGroup.maxParticipants || (currentGroup as any).limit_participant || 10;

    if (memberIds.includes(userId)) {
      return res.status(409).json({ error: "L'utilisateur fait deja partie de cette cotisation." });
    }

    if (memberIds.length >= max) {
      return res.status(409).json({ error: "Ce groupe de cotisation est deja complet." });
    }

    const updatedMemberIds = [...memberIds, userId];
    const newStatus = updatedMemberIds.length >= max ? 'ACTIF' : 'EN_ATTENTE';

    const group = await prisma.cotisationGroup.update({
      where: { id: idCotisation },
      data: {
        memberIds: updatedMemberIds,
        nb_participant: updatedMemberIds.length,
        status: newStatus,
      }
    });

    res.json({ message: "Successfully assigned to cotisation", data: group });
  } catch (error: any) {
    console.error('assignCotisation error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
