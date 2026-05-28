import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { computeAvalise } from '../utils/computeAvalise';
import { calculateTransferFee } from './adminController';

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
    console.error('getWallets error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const transfer = async (req: any, res: Response) => {
  try {
    const { recipientAccountNumber, amount, sourceAccountType = 'PRINCIPAL', targetAccountType = 'PRINCIPAL', purpose } = req.body;
    const senderId = req.user.userId;

    if (!recipientAccountNumber || !amount) {
      return res.status(400).json({ error: "Le numéro de compte destinataire et le montant sont requis." });
    }

    const transferAmount = Number(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return res.status(400).json({ error: "Le montant du transfert doit être un nombre positif." });
    }

    // 1. Rechercher l'expéditeur et le destinataire
    const sender = await prisma.user.findUnique({
      where: { id: senderId }
    });
    if (!sender) {
      return res.status(404).json({ error: "Expéditeur introuvable." });
    }

    const normalizedAccountNumber = String(recipientAccountNumber).trim().toUpperCase();
    const recipient = await prisma.user.findUnique({
      where: { accountNumber: normalizedAccountNumber }
    });

    if (!recipient) {
      return res.status(404).json({ error: `Destinataire avec le numéro de compte ${recipientAccountNumber} introuvable.` });
    }

    if (recipient.id === sender.id) {
      return res.status(400).json({ error: "Vous ne pouvez pas effectuer un transfert vers votre propre compte." });
    }

    // 2. Récupérer les comptes associés
    const senderAccounts = await prisma.account.findMany({
      where: { id: { in: sender.accountIds || [] } }
    });
    const recipientAccounts = await prisma.account.findMany({
      where: { id: { in: recipient.accountIds || [] } }
    });

    const senderSourceAccount = senderAccounts.find(a => a.type === sourceAccountType);
    const recipientTargetAccount = recipientAccounts.find(a => a.type === targetAccountType);

    if (!senderSourceAccount) {
      return res.status(400).json({ error: `Compte source de type ${sourceAccountType} introuvable pour l'expéditeur.` });
    }
    if (!recipientTargetAccount) {
      return res.status(400).json({ error: `Compte destinataire de type ${targetAccountType} introuvable pour le destinataire.` });
    }

    // 3. Calculer les frais de transfert
    const senderCurrency = senderSourceAccount.currency || 'XAF';
    const feeDetails = await calculateTransferFee(transferAmount, senderCurrency);
    const fee = feeDetails.fee;

    // Vérifier le solde disponible (montant + frais)
    const totalRequired = transferAmount + fee;
    if (senderSourceAccount.availableBalance < totalRequired) {
      return res.status(400).json({ 
        error: `Solde insuffisant pour couvrir le transfert et les frais. Requis : ${totalRequired} ${senderCurrency}, Disponible : ${senderSourceAccount.availableBalance} ${senderCurrency}` 
      });
    }

    // 4. Effectuer le transfert de manière atomique (Prisma transaction)
    const result = await prisma.$transaction(async (tx) => {
      // Déduire le montant chez l'expéditeur (montant + frais)
      await tx.account.update({
        where: { id: senderSourceAccount.id },
        data: {
          currentBalance: { decrement: totalRequired },
          availableBalance: { decrement: totalRequired }
        }
      });

      // Ajouter le montant chez le destinataire
      await tx.account.update({
        where: { id: recipientTargetAccount.id },
        data: {
          currentBalance: { increment: transferAmount },
          availableBalance: { increment: transferAmount }
        }
      });

      const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
      const senderTxRef = `TR_OUT_${Date.now()}_${sender.id}`;
      const recipientTxRef = `TR_IN_${Date.now()}_${recipient.id}`;

      // Créer la transaction de sortie chez l'expéditeur
      const senderTx = await tx.transaction.create({
        data: {
          userId: sender.id,
          amount: -totalRequired,
          currency: senderSourceAccount.currency || 'XAF',
          status: 'SUCCESS',
          purpose: purpose || `Transfert vers ${recipient.firstName} ${recipient.lastName}`,
          transactionRef: senderTxRef,
          sourceAccountType,
          targetAccountType,
          createdBy: "System",
          operation: {
            type: "transfer_out",
            code: senderTxRef,
            reference: `${dateStr}.TR-OUT.${sender.id}`,
            amount: -transferAmount,
            fee: fee,
            feeRate: feeDetails.rate,
            flatFee: feeDetails.flatFee,
            totalAmount: -totalRequired,
            date: new Date().toISOString(),
            recipient: {
              id: recipient.id,
              firstName: recipient.firstName,
              lastName: recipient.lastName,
              accountNumber: recipient.accountNumber
            }
          }
        }
      });

      // Créer la transaction d'entrée chez le destinataire
      const recipientTx = await tx.transaction.create({
        data: {
          userId: recipient.id,
          amount: transferAmount,
          currency: recipientTargetAccount.currency || 'XAF',
          status: 'SUCCESS',
          purpose: purpose || `Transfert reçu de ${sender.firstName} ${sender.lastName}`,
          transactionRef: recipientTxRef,
          sourceAccountType,
          targetAccountType,
          createdBy: "System",
          operation: {
            type: "transfer_in",
            code: recipientTxRef,
            reference: `${dateStr}.TR-IN.${recipient.id}`,
            amount: transferAmount,
            date: new Date().toISOString(),
            sender: {
              id: sender.id,
              firstName: sender.firstName,
              lastName: sender.lastName,
              accountNumber: sender.accountNumber
            }
          }
        }
      });

      return { senderTx, recipientTx };
    });

    return res.status(200).json({
      message: "Transfert effectué avec succès.",
      data: result
    });

  } catch (error: any) {
    console.error('transfer error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const transferPreview = async (req: any, res: Response) => {
  try {
    const { recipientAccountNumber, amount, sourceAccountType = 'PRINCIPAL', targetAccountType = 'PRINCIPAL' } = req.body;
    const senderId = req.user.userId;

    const transferAmount = Number(amount) || 0;

    // 1. Rechercher l'expéditeur
    const sender = await prisma.user.findUnique({
      where: { id: senderId }
    });
    if (!sender) {
      return res.status(404).json({ error: "Expéditeur introuvable." });
    }

    // 2. Récupérer les comptes de l'expéditeur
    const senderAccounts = await prisma.account.findMany({
      where: { id: { in: sender.accountIds || [] } }
    });
    const senderSourceAccount = senderAccounts.find(a => a.type === sourceAccountType);
    if (!senderSourceAccount) {
      return res.status(400).json({ error: `Compte source de type ${sourceAccountType} introuvable.` });
    }

    const senderCurrency = senderSourceAccount.currency || 'XAF';

    // 3. Calculer les frais de transfert
    let fee = 0;
    let feeRate = 0;
    let flatFee = 0;
    if (transferAmount > 0) {
      const feeDetails = await calculateTransferFee(transferAmount, senderCurrency);
      fee = feeDetails.fee;
      feeRate = feeDetails.rate;
      flatFee = feeDetails.flatFee;
    }

    const totalRequired = transferAmount + fee;

    // 4. Déterminer le destinataire et sa devise
    let destCurrencyCode = senderCurrency;
    let recipientName: string | null = null;
    let isDifferent = false;
    let conversionRate = 1.0;
    let convertedAmount = transferAmount;

    if (recipientAccountNumber) {
      const normalizedAccountNumber = String(recipientAccountNumber).trim().toUpperCase();
      const recipient = await prisma.user.findUnique({
        where: { accountNumber: normalizedAccountNumber }
      });

      if (recipient) {
        recipientName = `${recipient.firstName} ${recipient.lastName}`.toUpperCase();
        const recipientAccounts = await prisma.account.findMany({
          where: { id: { in: recipient.accountIds || [] } }
        });
        const recipientTargetAccount = recipientAccounts.find(a => a.type === targetAccountType);
        if (recipientTargetAccount) {
          destCurrencyCode = recipientTargetAccount.currency || 'XAF';
        }
      }
    }

    // 5. Calculer le taux de change si devises différentes
    if (senderCurrency !== destCurrencyCode) {
      const sourceCurrency = await prisma.currency.findUnique({ where: { code: senderCurrency } });
      const destCurrency = await prisma.currency.findUnique({ where: { code: destCurrencyCode } });

      const sourceRateToBase = sourceCurrency ? sourceCurrency.rateToBase : (senderCurrency === 'XAF' ? 1.0 : null);
      const destRateToBase = destCurrency ? destCurrency.rateToBase : (destCurrencyCode === 'XAF' ? 1.0 : null);

      if (sourceRateToBase !== null && destRateToBase !== null && destRateToBase > 0) {
        conversionRate = sourceRateToBase / destRateToBase;
        convertedAmount = transferAmount * conversionRate;
        isDifferent = true;
      }
    }

    return res.json({
      data: {
        sourceCurrency: senderCurrency,
        destCurrency: destCurrencyCode,
        amount: transferAmount,
        fee,
        feeRate,
        flatFee,
        totalRequired,
        rate: conversionRate,
        convertedAmount,
        isDifferent,
        recipientName
      }
    });

  } catch (error: any) {
    console.error('transferPreview error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const lookupUserByAccountNumber = async (req: any, res: Response) => {
  try {
    const { accountNumber } = req.params;
    if (!accountNumber) {
      return res.status(400).json({ error: "Numéro de compte requis." });
    }

    const normalizedAccountNumber = String(accountNumber).trim().toUpperCase();
    const user = await prisma.user.findUnique({
      where: { accountNumber: normalizedAccountNumber },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        accountNumber: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: "Compte destinataire introuvable." });
    }

    return res.json({ data: user });
  } catch (error: any) {
    console.error('lookupUserByAccountNumber error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
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
    console.error('getTransactions error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
