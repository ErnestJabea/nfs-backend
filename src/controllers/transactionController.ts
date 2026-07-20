import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { canAccessUser, getRequestUserId, requestIsAdmin } from '../utils/requestAccess';
import { guaranteeAmountEndorsed, guaranteeEntries, isGuaranteeActorAuthorized } from '../services/loanGuaranteeService';

const mapTransaction = (t: any) => {
  const operation = t.operation || {};
  const avaliste = operation.avalistes || operation.avaliste || t.avalistes || t.avaliste || [];
  return {
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
    operation: operation,
    beneficiary: t.beneficiary || null,
    userFirstName: t.user?.firstName,
    userLastName: t.user?.lastName,
    amountEndorsed: operation.amountEndorsed || t.validatedBy?.length || 0,
    avaliste: avaliste,
    avalistes: avaliste
  };
};

export const getUserTransactions = async (req: any, res: Response) => {
  try {
    const userId = req.params.userId || req.query.userId || getRequestUserId(req);


    if (!userId) return res.status(400).json({ error: "User ID required" });
    if (!canAccessUser(req, userId)) {
      return res.status(403).json({ error: "Acces refuse aux transactions de cet utilisateur." });
    }

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ data: transactions.map(mapTransaction) });
  } catch (error: any) {
    console.error('getUserTransactions error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCreditListPending = async (req: Request, res: Response) => {
  try {
    const requesterValue = getRequestUserId(req);
    if (!requesterValue) return res.status(401).json({ error: 'Session invalide.' });
    const requesterId = String(requesterValue);
    const transactions = await prisma.transaction.findMany({
      where: { 
        status: "PENDING",
        purpose: { contains: "CREDIT" },
        ...(requestIsAdmin(req) ? {} : { userId: requesterId }),
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ data: transactions.map(mapTransaction) });
  } catch (error: any) {
    console.error('getCreditListPending error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getEligibleCreditsForAvalise = async (req: Request, res: Response) => {
  try {
    const requesterValue = getRequestUserId(req);
    if (!requesterValue) return res.status(401).json({ error: 'Session invalide.' });
    const requesterId = String(requesterValue);

    const loans = await prisma.loan.findMany({
      where: { status: { in: ['PENDING', 'VALIDATED'] }, transactionId: { not: null } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, referredById: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const transactionIds = loans.map(loan => loan.transactionId).filter((id): id is string => Boolean(id));
    const transactions = transactionIds.length
      ? await prisma.transaction.findMany({ where: { id: { in: transactionIds } } })
      : [];
    const transactionById = new Map(transactions.map(transaction => [transaction.id, transaction]));

    const eligible = loans
      .map((loan) => {
        const transaction = loan.transactionId ? transactionById.get(loan.transactionId) : null;
        if (!transaction || transaction.status !== 'PENDING' || !String(transaction.purpose || '').includes('CREDIT')) return null;
        const operation: any = transaction.operation || {};
        if (String(operation.code || '').includes('AUTO')) return null;
        const avalistes = guaranteeEntries(operation.avalistes, operation.avaliste, loan.avalistes);
        if (!isGuaranteeActorAuthorized({
          guarantorId: requesterId,
          borrowerId: loan.userId,
          borrowerReferrerId: loan.user.referredById,
          avalistes,
        })) return null;
        const totalAmount = Number(loan.amount || transaction.amount || 0);
        const amountEndorsed = guaranteeAmountEndorsed(operation, loan.avalistes);
        const remainingGuarantee = Math.max(0, totalAmount - amountEndorsed);
        if (remainingGuarantee <= 0) return null;
        return {
          id: transaction.id,
          loanId: loan.id,
          borrowerName: `${loan.user.firstName || ''} ${loan.user.lastName || ''}`.trim() || 'Membre NFS',
          purpose: loan.purpose || transaction.purpose,
          amount: totalAmount,
          amountEndorsed,
          remainingGuarantee,
          currency: transaction.currency || 'XAF',
          createdAt: loan.createdAt || transaction.createdAt,
          authorization: loan.user.referredById === requesterId ? 'REFERRAL' : 'ASSIGNED',
        };
      })
      .filter(Boolean);

    return res.json({ data: eligible });
  } catch (error: any) {
    console.error('getEligibleCreditsForAvalise error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCumulCredit = async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '');
    const { status } = req.query; // PENDING or SUCCESS

    if (!canAccessUser(req, userId)) {
      return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
    }
    
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
    console.error('getCumulCredit error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const generateInvoice = async (req: Request, res: Response) => {
  // Mocking PDF response for now
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from("PDF Fake Content"));
};


export const createTransaction = async (req: any, res: Response) => {
  try {
    const { operationCode, userId, amount, beneficiary } = req.body;
    const authUserId = getRequestUserId(req);
    const finalUserId = userId || authUserId;

    if (!finalUserId) return res.status(400).json({ error: "User ID required" });
    if (!canAccessUser(req, finalUserId)) {
      return res.status(403).json({ error: "Vous ne pouvez pas creer une transaction pour un autre utilisateur." });
    }

    // Enregistrement de l'emprunt
    const transaction = await prisma.transaction.create({
      data: {
        userId: finalUserId,
        purpose: "CREDIT",
        amount: Number(amount) || 0,
        currency: req.body.sourceCurrency || "XAF",
        status: "PENDING",
        transactionRef: `${operationCode}_${Date.now()}_${finalUserId}`,
        createdBy: "System",
        targetAccountType: "CREDIT",
        operation: {
          type: "credit",
          code: operationCode || "EMPRUNT_${Date.now()}",
          reference: `${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.CR.${finalUserId}`,
          amount: Number(amount) || 0,
          date: new Date().toISOString(),
          beneficiary: beneficiary || null
        }
      }
    });

    // Mettre à jour/Créer l'objet Loan correspondant
    try {
      const config = await prisma.loanConfig.findFirst({ where: { code: operationCode } });
      const interestRate = config ? config.rate : 0;
      const durationMonths = config ? Math.ceil(config.duration / 30) : 6;
      await prisma.loan.create({
        data: {
          userId: finalUserId,
          amount: Number(amount) || 0,
          interestRate: interestRate,
          totalInterest: (Number(amount) || 0) * (interestRate / 100),
          duration: durationMonths,
          purpose: operationCode || "CREDIT",
          status: "PENDING",
          avalistes: beneficiary ? [beneficiary] : [],
          createdBy: "System"
        }
      });
    } catch (loanError) {
      console.error("Erreur creation de l'objet Loan dans la base de donnees:", loanError);
    }

    // Optionnel: Envoyer l'email au COMEX
    try {
      const { sendMail } = require('../utils/sendMail');
      const user = await prisma.user.findUnique({ where: { id: finalUserId } });
      const comexEmail = "comex@ndfashion.com"; // ou l'email admin
      const subject = "[NFS] Nouvelle demande de crédit en attente de validation";
      const html = `
        <h3>Nouvelle demande de Crédit</h3>
        <p><strong>Utilisateur :</strong> ${user?.firstName} ${user?.lastName}</p>
        <p><strong>Montant :</strong> ${amount} XAF</p>
        <p><strong>Type de crédit :</strong> ${operationCode}</p>
        <p>Veuillez vous connecter au backoffice pour valider cette demande.</p>
      `;
      await sendMail(comexEmail, subject, html);
    } catch (mailError) {
      console.error("Erreur envoi email COMEX:", mailError);
    }

    return res.status(200).json({ message: "Success", data: mapTransaction(transaction) });
  } catch (error: any) {
    console.error('createTransaction error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCreditsPublic = async (req: Request, res: Response) => {
  try {
    const configs = await prisma.loanConfig.findMany({ orderBy: { code: 'asc' } });
    const mapped = configs.map(c => ({
      id: c.id,
      code: c.code,
      description: `${c.code} (${c.rate}%, ${c.duration} jours)`,
      interest: c.rate,
      day: c.duration,
      createdAt: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : new Date().toISOString()
    }));
    return res.json({ data: mapped });
  } catch (error: any) {
    console.error('getCreditsPublic error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCreditById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const config = await prisma.loanConfig.findUnique({ where: { id: id } });
    if (!config) {
      return res.status(404).json({ error: "Credit config not found" });
    }
    const mapped = {
      id: config.id,
      code: config.code,
      description: `${config.code} (${config.rate}%, ${config.duration} jours)`,
      interest: config.rate,
      day: config.duration,
      createdAt: config.createdAt ? config.createdAt.toISOString() : new Date().toISOString(),
      updatedAt: config.updatedAt ? config.updatedAt.toISOString() : new Date().toISOString()
    };
    return res.json({ data: mapped });
  } catch (error: any) {
    console.error('getCreditById error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const getCreditByCode = async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code);
    const config = await prisma.loanConfig.findFirst({ where: { code } });
    if (!config) {
      // Retourner 0% si le code n'est pas trouvé (pas d'erreur bloquante)
      return res.json({ data: { code, interest: 0, day: 0, description: code } });
    }
    return res.json({
      data: {
        id: config.id,
        code: config.code,
        description: `${config.code} (${config.rate}%, ${config.duration} jours)`,
        interest: config.rate,
        day: config.duration,
        createdAt: config.createdAt ? config.createdAt.toISOString() : new Date().toISOString(),
        updatedAt: config.updatedAt ? config.updatedAt.toISOString() : new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('getCreditByCode error:', error);
    return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};

export const avaliseTransaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    const user = getRequestUserId(req);

    if (!user) {
      return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter." });
    }

    const transaction = await prisma.transaction.findUnique({ where: { id: id as string } });
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });

    let operation: any = transaction.operation || {};
    let amountEndorsed = Number(operation.amountEndorsed || 0);
    amountEndorsed += Number(amount);

    let avalistes = operation.avalistes || [];

    // Calcul des intérêts (Le calcul est déjà dans le backend lors de la création, ici on enregistre juste l'apport de l'avaliste)
    // On pourrait calculer la part des intérêts si besoin, mais le total est déjà dans totalInterest.
    const existingAvalisteIndex = avalistes.findIndex((a: any) => a.userId === user);
    if (existingAvalisteIndex !== -1) {
      avalistes[existingAvalisteIndex].amount += Number(amount);
      avalistes[existingAvalisteIndex].date = new Date().toISOString();
    } else {
      const userObj = await prisma.user.findUnique({ where: { id: user } });
      const fullName = userObj ? (userObj.firstName + ' ' + userObj.lastName) : 'Inconnu';
      avalistes.push({ userId: user, amount: Number(amount), date: new Date().toISOString(), name: fullName });
    }

    operation = { ...operation, amountEndorsed, avalistes };

    let newStatus = transaction.status;
    if (amountEndorsed >= Number(transaction.amount || 0)) {
      newStatus = "VALIDATED";
    }

    const validatedBy = transaction.validatedBy || [];
    const updateData: any = {
      operation: operation,
      status: newStatus || "PENDING"
    };
    if (!validatedBy.includes(user)) {
      updateData.validatedBy = { push: user };
    }

    const updated = await prisma.transaction.update({
      where: { id: id as string },
      data: updateData
    });

    // Mettre à jour l'objet Loan correspondant
    if (transaction.userId) {
      const loan = await prisma.loan.findFirst({
        where: { userId: transaction.userId, status: "PENDING" }
      });
      if (loan) {
        await prisma.loan.update({
          where: { id: loan.id },
          data: {
            avalistes: avalistes,
            status: newStatus || "PENDING"
          }
        });
      }
    }

    res.json({ data: mapTransaction(updated) });
  } catch (error: any) {
    console.error('Avalise error:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
  }
};
