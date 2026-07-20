import prisma from '../utils/prisma';
import { calculateTransferFee } from '../controllers/adminController';
import { createFundingCheckout } from './paymentInitiationService';
import { assertProviderAvailable } from './paymentProviderService';

class TransactionError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = 'TRANSACTION_REJECTED', status = 400) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const accountType = (value: unknown) => {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'WALLET') return 'PRINCIPAL';
  if (normalized === 'SAVINGS') return 'EPARGNE';
  if (['PRINCIPAL', 'EPARGNE'].includes(normalized)) return normalized;
  throw new TransactionError('Type de compte non autorise.', 'INVALID_ACCOUNT_TYPE');
};

const amountValue = (value: unknown) => {
  const amount = Number(value);
  const maximum = Number(process.env.MAX_TRANSACTION_AMOUNT_XAF || 100_000_000);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maximum) {
    throw new TransactionError('Montant de transaction invalide.', 'INVALID_AMOUNT');
  }
  return amount;
};

const cameroonMobileNumber = (value: unknown) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00237')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  if (digits.length === 9) digits = `237${digits}`;
  if (!/^2376\d{8}$/.test(digits)) {
    throw new TransactionError('Numero Mobile Money camerounais invalide.', 'INVALID_MOBILE_MONEY_PHONE');
  }
  return digits;
};

const objectIdValue = (value: unknown, name: string) => {
  const id = String(value || '');
  if (!/^[a-f\d]{24}$/i.test(id)) throw new TransactionError(`${name} invalide.`, 'INVALID_ID');
  return id;
};

const contributionPeriodKey = (frequency: unknown, date = new Date()) => {
  const normalized = String(frequency || 'MONTHLY').toUpperCase();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (normalized === 'DAILY') return `${year}-${month}-${day}`;
  if (normalized === 'WEEKLY') {
    const target = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const weekDay = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - weekDay);
    const firstDay = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((target.getTime() - firstDay.getTime()) / 86400000) + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return `${year}-${month}`;
};

const getOwnedAccount = async (db: any, userId: string, type: string) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
  if (!user) throw new TransactionError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  const account = await db.account.findFirst({ where: { id: { in: user.accountIds || [] }, type } });
  if (!account) throw new TransactionError(`Compte ${type} introuvable.`, 'ACCOUNT_NOT_FOUND', 404);
  return account;
};

const debit = async (db: any, accountId: string, amount: number) => {
  const result = await db.account.updateMany({
    where: {
      id: accountId,
      currentBalance: { gte: amount },
      availableBalance: { gte: amount },
    },
    data: {
      currentBalance: { decrement: amount },
      availableBalance: { decrement: amount },
    },
  });
  if (result.count !== 1) throw new TransactionError('Solde insuffisant.', 'INSUFFICIENT_FUNDS', 409);
};

const credit = (db: any, accountId: string, amount: number) => db.account.update({
  where: { id: accountId },
  data: {
    currentBalance: { increment: amount },
    availableBalance: { increment: amount },
  },
});

const getAvaliseCapacity = async (db: any, userId: string) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
  if (!user) throw new TransactionError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  const accounts = await db.account.findMany({ where: { id: { in: user.accountIds || [] } } });
  const balance = (...types: string[]) => Number(accounts.find((account: any) => types.includes(account.type))?.currentBalance || 0);
  const capacity = Math.max(0,
    balance('EPARGNE') + balance('DJANGUI_NON_PERCU', 'DJANGUI_NONPERCU')
    - balance('CREDIT') - balance('PRET') - balance('CREDIT_AVALISE') - balance('PARRAINAGE'),
  );
  return { user, accounts, capacity };
};

export const prepareTransactionPayload = async (userId: string, typeValue: unknown, input: any) => {
  const type = String(typeValue || '').toUpperCase();
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  if (type === 'ACCOUNT_FUNDING') {
    const amount = amountValue(payload.amount);
    const minimum = Number(process.env.PAYMENT_MIN_AMOUNT_XAF || 100);
    const maximum = Number(process.env.PAYMENT_MAX_AMOUNT_XAF || 5_000_000);
    if (amount < minimum || amount > maximum) {
      throw new TransactionError(
        `Le montant doit etre compris entre ${minimum.toLocaleString('fr-FR')} et ${maximum.toLocaleString('fr-FR')} XAF.`,
        'PAYMENT_AMOUNT_OUT_OF_RANGE',
      );
    }
    const targetAccountType = accountType(payload.targetAccountType || payload.accountType || 'PRINCIPAL');
    const { provider, method } = assertProviderAvailable(payload.provider, payload.method);
    const [account, user] = await Promise.all([
      getOwnedAccount(prisma, userId, targetAccountType),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } }),
    ]);
    if (account.currency !== 'XAF') {
      throw new TransactionError('Seuls les comptes XAF peuvent etre approvisionnes.', 'PAYMENT_CURRENCY_UNSUPPORTED');
    }
    if (!user) throw new TransactionError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
    if (provider === 'FLUTTERWAVE' && !user.email) {
      throw new TransactionError('Ajoutez une adresse email verifiee a votre profil avant ce paiement.', 'PAYMENT_EMAIL_REQUIRED');
    }
    const phone = method === 'CARD' ? user.phone : cameroonMobileNumber(payload.phone || user.phone);
    return {
      type,
      payload: { amount, targetAccountType, provider, method, phone },
      summary: `Approvisionnement de ${amount.toLocaleString('fr-FR')} XAF sur ${targetAccountType} via ${provider}`,
    };
  }

  if (type === 'INTERNAL_TRANSFER') {
    const amount = amountValue(payload.amount);
    const sourceAccountType = accountType(payload.fromAccount || payload.sourceAccountType);
    const targetAccountType = accountType(payload.toAccount || payload.targetAccountType);
    if (sourceAccountType === targetAccountType) {
      throw new TransactionError('Les comptes source et destination doivent etre differents.', 'SAME_ACCOUNT');
    }
    await Promise.all([
      getOwnedAccount(prisma, userId, sourceAccountType),
      getOwnedAccount(prisma, userId, targetAccountType),
    ]);
    return {
      type,
      payload: {
        amount,
        sourceAccountType,
        targetAccountType,
        purpose: String(payload.description || payload.purpose || 'Transfert interne').trim().slice(0, 140),
      },
      summary: `${amount.toLocaleString('fr-FR')} XAF de ${sourceAccountType} vers ${targetAccountType}`,
    };
  }

  if (type === 'WALLET_TRANSFER') {
    const amount = amountValue(payload.amount);
    const sourceAccountType = accountType(payload.sourceAccountType || 'PRINCIPAL');
    const targetAccountType = accountType(payload.targetAccountType || 'PRINCIPAL');
    const recipientAccountNumber = String(payload.recipientAccountNumber || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,40}$/.test(recipientAccountNumber)) {
      throw new TransactionError('Numero de compte destinataire invalide.', 'INVALID_RECIPIENT');
    }
    const [source, recipient] = await Promise.all([
      getOwnedAccount(prisma, userId, sourceAccountType),
      prisma.user.findUnique({ where: { accountNumber: recipientAccountNumber } }),
    ]);
    if (!recipient || recipient.id === userId) throw new TransactionError('Destinataire invalide.', 'INVALID_RECIPIENT');
    await getOwnedAccount(prisma, recipient.id, targetAccountType);
    const fees = await calculateTransferFee(amount, source.currency || 'XAF');
    return {
      type,
      payload: {
        amount,
        fee: fees.fee,
        sourceAccountType,
        targetAccountType,
        recipientUserId: recipient.id,
        recipientAccountNumber,
        purpose: String(payload.purpose || 'Transfert NFS').trim().slice(0, 140),
      },
      summary: `${amount.toLocaleString('fr-FR')} XAF vers ...${recipientAccountNumber.slice(-4)} (frais ${fees.fee.toLocaleString('fr-FR')} XAF)`,
    };
  }

  if (type === 'LOAN_REQUEST') {
    const amount = amountValue(payload.amount);
    const durationMonths = Number(payload.durationMonths);
    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 60) {
      throw new TransactionError('Duree de credit invalide.', 'INVALID_DURATION');
    }
    const avalistes = Array.isArray(payload.avalistes) ? payload.avalistes.slice(0, 5) : [];
    const pendingLoan = await prisma.loan.findFirst({ where: { userId, status: 'PENDING' }, select: { id: true } });
    if (pendingLoan) throw new TransactionError('Une demande de credit est deja en attente.', 'PENDING_LOAN_EXISTS', 409);
    return {
      type,
      payload: {
        amount,
        durationMonths,
        purpose: String(payload.purpose || 'Credit NFS').trim().slice(0, 200),
        avalistes,
      },
      summary: `Demande de credit de ${amount.toLocaleString('fr-FR')} XAF sur ${durationMonths} mois`,
    };
  }

  if (type === 'AVALISE_CREDIT') {
    const transactionId = objectIdValue(payload.transactionId, 'Demande de credit');
    const amount = amountValue(payload.amount);
    const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.status !== 'PENDING' || !String(transaction.purpose || '').includes('CREDIT') || !transaction.userId) {
      throw new TransactionError('Demande de credit indisponible.', 'CREDIT_UNAVAILABLE', 404);
    }
    if (transaction.userId === userId) throw new TransactionError('Vous ne pouvez pas avaliser votre propre credit.', 'SELF_GUARANTEE', 403);

    const [borrower, capacityData] = await Promise.all([
      prisma.user.findUnique({ where: { id: transaction.userId }, select: { referredById: true } }),
      getAvaliseCapacity(prisma, userId),
    ]);
    if (!borrower || borrower.referredById !== userId) {
      throw new TransactionError('Cette demande ne fait pas partie de votre reseau autorise.', 'GUARANTEE_NOT_ALLOWED', 403);
    }
    const operation: any = transaction.operation || {};
    const remainingGuarantee = Math.max(0, Number(transaction.amount || 0) - Number(operation.amountEndorsed || 0));
    if (amount > remainingGuarantee) throw new TransactionError('Le montant depasse la garantie restante.', 'GUARANTEE_AMOUNT_TOO_HIGH', 409);
    if (amount > capacityData.capacity) throw new TransactionError("Capacite d'avalise insuffisante.", 'INSUFFICIENT_GUARANTEE_CAPACITY', 409);

    return {
      type,
      payload: { transactionId, borrowerUserId: transaction.userId, amount },
      summary: `Avalise de ${amount.toLocaleString('fr-FR')} XAF pour la demande ...${transactionId.slice(-6)}`,
    };
  }

  if (type === 'COTISATION_JOIN' || type === 'COTISATION_PAYMENT') {
    const groupId = objectIdValue(payload.groupId, 'Groupe de cotisation');
    const group = await prisma.cotisationGroup.findUnique({ where: { id: groupId } });
    if (!group || !['ACTIF', 'ACTIVE'].includes(String(group.status).toUpperCase())) {
      throw new TransactionError('Groupe de cotisation indisponible.', 'GROUP_UNAVAILABLE', 404);
    }
    if (type === 'COTISATION_JOIN') {
      if (group.memberIds.includes(userId)) throw new TransactionError('Vous etes deja membre de ce groupe.', 'ALREADY_MEMBER', 409);
      if (group.maxParticipants && (group.nb_participant || group.memberIds.length) >= group.maxParticipants) {
        throw new TransactionError('Ce groupe est complet.', 'GROUP_FULL', 409);
      }
      return {
        type,
        payload: { groupId, expectedMemberCount: group.nb_participant || group.memberIds.length },
        summary: `Adhesion a la cotisation ${String(group.name).slice(0, 80)}`,
      };
    }
    if (!group.memberIds.includes(userId)) throw new TransactionError('Vous ne faites pas partie de ce groupe.', 'NOT_A_MEMBER', 403);
    const amount = amountValue(group.amount);
    return {
      type,
      payload: { groupId, amount },
      summary: `Cotisation ${String(group.name).slice(0, 80)} : ${amount.toLocaleString('fr-FR')} XAF`,
    };
  }

  throw new TransactionError('Type de transaction non pris en charge.', 'UNSUPPORTED_TRANSACTION_TYPE');
};

export const executeTransactionIntent = async (intent: any) => {
  const payload: any = intent.payload;

  if (intent.type === 'ACCOUNT_FUNDING') {
    return createFundingCheckout(intent, payload);
  }

  if (intent.type === 'INTERNAL_TRANSFER') {
    return prisma.$transaction(async (tx) => {
      const source = await getOwnedAccount(tx, intent.userId, payload.sourceAccountType);
      const target = await getOwnedAccount(tx, intent.userId, payload.targetAccountType);
      await debit(tx, source.id, payload.amount);
      await credit(tx, target.id, payload.amount);
      const reference = `TI_${intent.id}`;
      const outgoing = await tx.transaction.create({
        data: {
          userId: intent.userId,
          purpose: payload.purpose,
          amount: -payload.amount,
          status: 'SUCCESS',
          transactionRef: `${reference}_OUT`,
          sourceAccountType: payload.sourceAccountType,
          targetAccountType: payload.targetAccountType,
          currency: source.currency,
          createdBy: 'TransactionAuthorization',
          operation: { type: 'internal_transfer_out', intentId: intent.id, amount: payload.amount },
        },
      });
      await tx.transaction.create({
        data: {
          userId: intent.userId,
          purpose: payload.purpose,
          amount: payload.amount,
          status: 'SUCCESS',
          transactionRef: `${reference}_IN`,
          sourceAccountType: payload.sourceAccountType,
          targetAccountType: payload.targetAccountType,
          currency: target.currency,
          createdBy: 'TransactionAuthorization',
          operation: { type: 'internal_transfer_in', intentId: intent.id, amount: payload.amount },
        },
      });
      return { transactionId: outgoing.id, reference, status: 'SUCCESS' };
    });
  }

  if (intent.type === 'WALLET_TRANSFER') {
    return prisma.$transaction(async (tx) => {
      const source = await getOwnedAccount(tx, intent.userId, payload.sourceAccountType);
      const target = await getOwnedAccount(tx, payload.recipientUserId, payload.targetAccountType);
      const currentFees = await calculateTransferFee(payload.amount, source.currency || 'XAF');
      if (currentFees.fee !== payload.fee) {
        throw new TransactionError('Les frais ont change. Creez une nouvelle autorisation.', 'TRANSACTION_DATA_CHANGED', 409);
      }
      const totalDebit = payload.amount + payload.fee;
      await debit(tx, source.id, totalDebit);
      await credit(tx, target.id, payload.amount);
      const reference = `TI_${intent.id}`;
      const outgoing = await tx.transaction.create({
        data: {
          userId: intent.userId,
          purpose: payload.purpose,
          amount: -totalDebit,
          status: 'SUCCESS',
          transactionRef: `${reference}_OUT`,
          sourceAccountType: payload.sourceAccountType,
          targetAccountType: payload.targetAccountType,
          currency: source.currency,
          createdBy: 'TransactionAuthorization',
          operation: { type: 'transfer_out', intentId: intent.id, amount: payload.amount, fee: payload.fee, recipientAccountNumber: payload.recipientAccountNumber },
        },
      });
      await tx.transaction.create({
        data: {
          userId: payload.recipientUserId,
          purpose: 'Transfert NFS recu',
          amount: payload.amount,
          status: 'SUCCESS',
          transactionRef: `${reference}_IN`,
          sourceAccountType: payload.sourceAccountType,
          targetAccountType: payload.targetAccountType,
          currency: target.currency,
          createdBy: 'TransactionAuthorization',
          operation: { type: 'transfer_in', intentId: intent.id, amount: payload.amount },
        },
      });
      return { transactionId: outgoing.id, reference, status: 'SUCCESS' };
    });
  }

  if (intent.type === 'LOAN_REQUEST') {
    return prisma.$transaction(async (tx) => {
      const pendingLoan = await tx.loan.findFirst({ where: { userId: intent.userId, status: 'PENDING' }, select: { id: true } });
      if (pendingLoan) throw new TransactionError('Une demande de credit est deja en attente.', 'PENDING_LOAN_EXISTS', 409);
      const reference = `LOAN_${intent.id}`;
      const transaction = await tx.transaction.create({
        data: {
          userId: intent.userId,
          purpose: `CREDIT - ${payload.purpose}`,
          amount: payload.amount,
          status: 'PENDING',
          transactionRef: reference,
          targetAccountType: 'CREDIT',
          currency: 'XAF',
          createdBy: 'TransactionAuthorization',
          operation: { type: 'loan_request', intentId: intent.id, durationMonths: payload.durationMonths, avalistes: payload.avalistes },
        },
      });
      const rate = Number(process.env.DEFAULT_LOAN_INTEREST_RATE || 5);
      const loan = await tx.loan.create({
        data: {
          userId: intent.userId,
          transactionId: transaction.id,
          amount: payload.amount,
          duration: payload.durationMonths,
          purpose: payload.purpose,
          interestRate: rate,
          totalInterest: payload.amount * rate / 100,
          status: 'PENDING',
          avalistes: payload.avalistes,
          createdBy: 'TransactionAuthorization',
        },
      });
      return { transactionId: transaction.id, loanId: loan.id, reference, status: 'PENDING' };
    });
  }

  if (intent.type === 'AVALISE_CREDIT') {
    return prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({ where: { id: payload.transactionId } });
      if (!transaction || transaction.status !== 'PENDING' || transaction.userId !== payload.borrowerUserId) {
        throw new TransactionError('La demande de credit a change.', 'TRANSACTION_DATA_CHANGED', 409);
      }
      const borrower = await tx.user.findUnique({ where: { id: payload.borrowerUserId }, select: { referredById: true } });
      if (!borrower || borrower.referredById !== intent.userId) {
        throw new TransactionError('Cette demande ne fait plus partie de votre reseau autorise.', 'GUARANTEE_NOT_ALLOWED', 403);
      }

      const capacityData = await getAvaliseCapacity(tx, intent.userId);
      if (payload.amount > capacityData.capacity) {
        throw new TransactionError("Capacite d'avalise insuffisante.", 'INSUFFICIENT_GUARANTEE_CAPACITY', 409);
      }

      const operation: any = transaction.operation || {};
      const currentAmountEndorsed = Number(operation.amountEndorsed || 0);
      const remainingGuarantee = Math.max(0, Number(transaction.amount || 0) - currentAmountEndorsed);
      if (payload.amount > remainingGuarantee) {
        throw new TransactionError('Le montant depasse la garantie restante.', 'TRANSACTION_DATA_CHANGED', 409);
      }

      let liabilityAccount = capacityData.accounts.find((account: any) => account.type === 'CREDIT_AVALISE');
      if (liabilityAccount) {
        liabilityAccount = await credit(tx, liabilityAccount.id, payload.amount);
      } else {
        liabilityAccount = await tx.account.create({
          data: { type: 'CREDIT_AVALISE', currency: 'XAF', currentBalance: payload.amount, availableBalance: payload.amount },
        });
        await tx.user.update({ where: { id: intent.userId }, data: { accountIds: { push: liabilityAccount.id } } });
      }

      const guarantor = await tx.user.findUnique({ where: { id: intent.userId }, select: { firstName: true, lastName: true } });
      const guarantorName = `${guarantor?.firstName || ''} ${guarantor?.lastName || ''}`.trim() || 'Avaliste NFS';
      const avalistes = Array.isArray(operation.avalistes) ? [...operation.avalistes] : [];
      const existingIndex = avalistes.findIndex((entry: any) => entry.userId === intent.userId);
      if (existingIndex >= 0) {
        avalistes[existingIndex] = { ...avalistes[existingIndex], amount: Number(avalistes[existingIndex].amount || 0) + payload.amount, date: new Date().toISOString() };
      } else {
        avalistes.push({ userId: intent.userId, name: guarantorName, amount: payload.amount, date: new Date().toISOString() });
      }
      const amountEndorsed = currentAmountEndorsed + payload.amount;
      const newStatus = amountEndorsed >= Number(transaction.amount || 0) ? 'VALIDATED' : 'PENDING';
      const validatedBy = transaction.validatedBy || [];
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          operation: { ...operation, amountEndorsed, avalistes, lastAvaliseIntentId: intent.id },
          status: newStatus,
          ...(!validatedBy.includes(intent.userId) ? { validatedBy: { push: intent.userId } } : {}),
        },
      });

      const loan = await tx.loan.findFirst({
        where: { OR: [{ transactionId: transaction.id }, { userId: payload.borrowerUserId, status: 'PENDING' }] },
      });
      if (loan) {
        await tx.loan.update({ where: { id: loan.id }, data: { avalistes, status: newStatus } });
      }

      return {
        transactionId: transaction.id,
        amount: payload.amount,
        remainingGuarantee: Math.max(0, remainingGuarantee - payload.amount),
        liabilityAccountId: liabilityAccount.id,
        status: newStatus,
      };
    });
  }

  if (intent.type === 'COTISATION_JOIN') {
    return prisma.$transaction(async (tx) => {
      const group = await tx.cotisationGroup.findUnique({ where: { id: payload.groupId } });
      if (!group || group.memberIds.includes(intent.userId)) throw new TransactionError('Adhesion deja traitee ou groupe introuvable.', 'GROUP_STATE_CHANGED', 409);
      if (group.maxParticipants && (group.nb_participant || group.memberIds.length) >= group.maxParticipants) {
        throw new TransactionError('Ce groupe est complet.', 'GROUP_FULL', 409);
      }
      await tx.cotisationGroup.update({
        where: { id: group.id },
        data: { memberIds: { push: intent.userId }, nb_participant: { increment: 1 } },
      });
      return { groupId: group.id, status: 'SUCCESS' };
    });
  }

  if (intent.type === 'COTISATION_PAYMENT') {
    return prisma.$transaction(async (tx) => {
      const group = await tx.cotisationGroup.findUnique({ where: { id: payload.groupId } });
      if (!group || !group.memberIds.includes(intent.userId) || group.amount !== payload.amount) {
        throw new TransactionError('Les donnees de la cotisation ont change.', 'TRANSACTION_DATA_CHANGED', 409);
      }
      const reference = `COT_${intent.id}`;
      const periodKey = contributionPeriodKey(group.frequency);
      const existingPayment = await tx.cotisationPayment.findFirst({
        where: { userId: intent.userId, groupId: group.id, periodKey },
        select: { id: true },
      });
      if (existingPayment) throw new TransactionError('La cotisation de cette periode est deja payee.', 'CONTRIBUTION_ALREADY_PAID', 409);
      await tx.cotisationPayment.create({
        data: { userId: intent.userId, groupId: group.id, periodKey, amount: payload.amount, transactionRef: reference },
      });
      const source = await getOwnedAccount(tx, intent.userId, 'PRINCIPAL');
      await debit(tx, source.id, payload.amount);
      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: { code: 'NFS_GLOBAL', totalSavings: payload.amount, availableLiquidity: payload.amount },
        update: { totalSavings: { increment: payload.amount }, availableLiquidity: { increment: payload.amount }, lastUpdated: new Date() },
      });
      const transaction = await tx.transaction.create({
        data: {
          userId: intent.userId,
          purpose: `Cotisation ${group.name}`,
          amount: -payload.amount,
          status: 'SUCCESS',
          transactionRef: reference,
          sourceAccountType: 'PRINCIPAL',
          currency: source.currency,
          createdBy: 'TransactionAuthorization',
          operation: { type: 'cotisation_payment', intentId: intent.id, groupId: group.id },
        },
      });
      return { transactionId: transaction.id, reference, status: 'SUCCESS' };
    });
  }

  throw new TransactionError('Type de transaction non pris en charge.', 'UNSUPPORTED_TRANSACTION_TYPE');
};
