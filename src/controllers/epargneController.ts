import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { sendEpargneRequestMail, sendEpargneValidationMail } from '../services/mailService';

const prisma = new PrismaClient();

export const requestEpargne = async (req: Request, res: Response) => {
  try {
    const { userId, amount } = req.body;
    
    if (!userId || !amount) {
      return res.status(400).json({ error: "userId and amount are required" });
    }

    // Récupérer l'utilisateur pour l'email
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Check balance
    const accounts = await prisma.account.findMany({ where: { id: { in: user.accountIds || [] } } });
    const principalAcc = accounts.find((a: any) => a.type === 'PRINCIPAL');
    if (!principalAcc || principalAcc.availableBalance < amount) {
      return res.status(400).json({ error: `Solde principal insuffisant pour cette opération d'épargne.` });
    }

    // Récupérer tous les admins pour la notification
    const admins = await prisma.user.findMany({
      where: { roles: { has: "ADMIN" } }
    });
    const adminEmails = admins.map(a => a.email).filter(e => e) as string[];

    const dateStr = new Date().toISOString().split('T')[0].split('-').reverse().join('-');

    // Créer la transaction en PENDING
    const transactionRef = `EPARGNE_${Date.now()}_${userId}`;
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        amount,
        status: "PENDING",
        purpose: "EPARGNE",
        sourceAccountType: "PRINCIPAL",
        targetAccountType: "EPARGNE",
        transactionRef: transactionRef,
        operation: {
          type: "epargne",
          code: `EPARGNE_${Date.now()}`,
          reference: `${dateStr}.EP.${userId}`,
          amount,
          date: new Date().toISOString()
        }
      }
    });

    // Envoyer les emails
    if (user.email) {
      await sendEpargneRequestMail(user.email, `${user.firstName || ''} ${user.lastName || ''}`.trim(), amount, adminEmails);
    }

    res.status(201).json({ message: "Epargne request created", data: transaction });
  } catch (error: any) {
    console.error('requestEpargne error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const validateEpargne = async (req: Request, res: Response) => {
  try {
    const transactionId = String(req.params.transactionId);
    const adminId = (req as any).user?.userId || (req as any).user?.sub;

    if (!adminId) return res.status(401).json({ error: "Unauthorized" });

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: true }
    });

    if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    if (transaction.status === "SUCCESS" || transaction.status === "APPROVED") {
      return res.status(400).json({ error: "Transaction already validated" });
    }

    const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
    const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : '';
    if (transaction.createdBy && adminName && transaction.createdBy === adminName) {
      return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez initiée." });
    }

    // Update Transaction
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "APPROVED",
        validatedBy: { push: adminId }
      }
    });
    
    // Envoyer email au client
    if (transaction.user?.email) {
      await sendEpargneValidationMail(
        transaction.user.email, 
        `${transaction.user.firstName || ''} ${transaction.user.lastName || ''}`.trim(), 
        transaction.amount || 0
      );
    }

    res.json({ message: "Epargne validated", data: updatedTransaction });
  } catch (error: any) {
    console.error('validateEpargne error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const directEpargne = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.sub;

    if (!userId || !amount) {
      return res.status(400).json({ error: "userId and amount are required" });
    }

    const rechargeAmount = Number(amount);
    if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
      return res.status(400).json({ error: "Le montant de recharge doit être un nombre positif." });
    }

    // 1. Rechercher l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    // 2. Récupérer les comptes associés
    const accounts = await prisma.account.findMany({
      where: { id: { in: user.accountIds || [] } }
    });

    const principalAccount = accounts.find(a => a.type === 'PRINCIPAL');
    const epargneAccount = accounts.find(a => a.type === 'EPARGNE');

    if (!principalAccount) {
      return res.status(400).json({ error: "Compte principal introuvable." });
    }
    if (!epargneAccount) {
      return res.status(400).json({ error: "Compte épargne introuvable." });
    }

    // 3. Valider le solde du compte principal
    if (principalAccount.availableBalance < rechargeAmount) {
      return res.status(400).json({
        error: `Solde insuffisant dans votre portefeuille principal. Disponible : ${principalAccount.availableBalance} ${principalAccount.currency}`
      });
    }

    const dateStr = new Date().toISOString().split('T')[0].split('-').reverse().join('-');
    const transferRef = `EPARGNE_DIR_${Date.now()}_${userId}`;

    // 4. Effectuer le transfert d'épargne direct (transaction atomique)
    const result = await prisma.$transaction(async (tx) => {
      // Déduire le montant du compte principal
      await tx.account.update({
        where: { id: principalAccount.id },
        data: {
          currentBalance: { decrement: rechargeAmount },
          availableBalance: { decrement: rechargeAmount }
        }
      });

      // Ajouter le montant au compte d'épargne
      await tx.account.update({
        where: { id: epargneAccount.id },
        data: {
          currentBalance: { increment: rechargeAmount },
          availableBalance: { increment: rechargeAmount }
        }
      });

      // Créer la transaction de débit (wallet)
      await tx.transaction.create({
        data: {
          userId,
          amount: -rechargeAmount,
          currency: principalAccount.currency || 'XAF',
          status: 'SUCCESS',
          purpose: `Recharge Épargne directe`,
          transactionRef: `${transferRef}_OUT`,
          sourceAccountType: 'PRINCIPAL',
          targetAccountType: 'EPARGNE',
          createdBy: "System",
          operation: {
            type: "transfer_out",
            code: `${transferRef}_OUT`,
            reference: `${dateStr}.EP-OUT.${userId}`,
            amount: -rechargeAmount,
            date: new Date().toISOString()
          }
        }
      });

      // Créer la transaction de crédit (épargne)
      const epargneTx = await tx.transaction.create({
        data: {
          userId,
          amount: rechargeAmount,
          currency: epargneAccount.currency || 'XAF',
          status: 'SUCCESS',
          purpose: `Recharge Épargne directe`,
          transactionRef: `${transferRef}_IN`,
          sourceAccountType: 'PRINCIPAL',
          targetAccountType: 'EPARGNE',
          createdBy: "System",
          operation: {
            type: "epargne",
            code: `${transferRef}_IN`,
            reference: `${dateStr}.EP-IN.${userId}`,
            amount: rechargeAmount,
            date: new Date().toISOString()
          }
        }
      });

      return epargneTx;
    });

    res.status(200).json({ message: "Recharge d'épargne effectuée avec succès.", data: result });
  } catch (error: any) {
    console.error('directEpargne error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
