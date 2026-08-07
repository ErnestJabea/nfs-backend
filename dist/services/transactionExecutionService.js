"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTransactionIntent = exports.prepareTransactionPayload = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const adminController_1 = require("../controllers/adminController");
const mailer_1 = require("../utils/mailer");
const computeAvalise_1 = require("../utils/computeAvalise");
class TransactionError extends Error {
    constructor(message, code = 'TRANSACTION_REJECTED', status = 400) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
const accountType = (value) => {
    const normalized = String(value || '').toUpperCase();
    if (normalized === 'WALLET')
        return 'PRINCIPAL';
    if (normalized === 'SAVINGS')
        return 'EPARGNE';
    if (['PRINCIPAL', 'EPARGNE'].includes(normalized))
        return normalized;
    throw new TransactionError('Type de compte non autorise.', 'INVALID_ACCOUNT_TYPE');
};
const amountValue = (value) => {
    const amount = Number(value);
    const maximum = Number(process.env.MAX_TRANSACTION_AMOUNT_XAF || 100000000000);
    if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
        throw new TransactionError('Montant de transaction invalide.', 'INVALID_AMOUNT');
    }
    return amount;
};
const objectIdValue = (value, name) => {
    const id = String(value || '');
    if (!/^[a-f\d]{24}$/i.test(id))
        throw new TransactionError(`${name} invalide.`, 'INVALID_ID');
    return id;
};
const contributionPeriodKey = (frequency, date = new Date()) => {
    const normalized = String(frequency || 'MONTHLY').toUpperCase();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    if (normalized === 'DAILY')
        return `${year}-${month}-${day}`;
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
const getOwnedAccount = (db, userId, type) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield db.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
    if (!user)
        throw new TransactionError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
    const account = yield db.account.findFirst({ where: { id: { in: user.accountIds || [] }, type } });
    if (!account)
        throw new TransactionError(`Compte ${type} introuvable.`, 'ACCOUNT_NOT_FOUND', 404);
    return account;
});
const debit = (db, accountId, amount) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield db.account.updateMany({
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
    if (result.count !== 1)
        throw new TransactionError('Solde insuffisant.', 'INSUFFICIENT_FUNDS', 409);
});
const credit = (db, accountId, amount) => db.account.update({
    where: { id: accountId },
    data: {
        currentBalance: { increment: amount },
        availableBalance: { increment: amount },
    },
});
const getAvaliseCapacity = (db, userId) => __awaiter(void 0, void 0, void 0, function* () {
    const user = yield db.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
    if (!user)
        throw new TransactionError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
    const accounts = yield db.account.findMany({ where: { id: { in: user.accountIds || [] } } });
    const balance = (...types) => { var _a; return Number(((_a = accounts.find((account) => types.includes(account.type))) === null || _a === void 0 ? void 0 : _a.currentBalance) || 0); };
    const capacity = Math.max(0, balance('EPARGNE') + balance('DJANGUI_NON_PERCU', 'DJANGUI_NONPERCU')
        - balance('CREDIT') - balance('PRET') - balance('CREDIT_AVALISE') - balance('PARRAINAGE'));
    return { user, accounts, capacity };
});
const prepareTransactionPayload = (userId, typeValue, input) => __awaiter(void 0, void 0, void 0, function* () {
    const type = String(typeValue || '').toUpperCase();
    const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    if (type === 'INTERNAL_TRANSFER') {
        const amount = amountValue(payload.amount);
        const sourceAccountType = accountType(payload.fromAccount || payload.sourceAccountType);
        const targetAccountType = accountType(payload.toAccount || payload.targetAccountType);
        if (sourceAccountType === targetAccountType) {
            throw new TransactionError('Les comptes source et destination doivent etre differents.', 'SAME_ACCOUNT');
        }
        yield Promise.all([
            getOwnedAccount(prisma_1.default, userId, sourceAccountType),
            getOwnedAccount(prisma_1.default, userId, targetAccountType),
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
        const [source, recipient] = yield Promise.all([
            getOwnedAccount(prisma_1.default, userId, sourceAccountType),
            prisma_1.default.user.findUnique({ where: { accountNumber: recipientAccountNumber } }),
        ]);
        if (!recipient || recipient.id === userId)
            throw new TransactionError('Destinataire invalide.', 'INVALID_RECIPIENT');
        yield getOwnedAccount(prisma_1.default, recipient.id, targetAccountType);
        const fees = yield (0, adminController_1.calculateTransferFee)(amount, source.currency || 'XAF');
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
        const creditTypeCode = String(payload.creditTypeCode || payload.creditType || payload.code || '').toUpperCase();
        let rate = Number(process.env.DEFAULT_LOAN_INTEREST_RATE || 5);
        let durationMonths = Number(payload.durationMonths || 6);
        if (creditTypeCode) {
            const config = yield prisma_1.default.loanConfig.findFirst({ where: { code: creditTypeCode } });
            if (config) {
                rate = Number(config.rate !== undefined ? config.rate : rate);
                durationMonths = Math.max(1, Math.ceil(Number(config.duration || 180) / 30));
            }
        }
        if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 60) {
            throw new TransactionError('Duree de credit invalide.', 'INVALID_DURATION');
        }
        // 1. Calcul de la Capacité d'Avalise C_aval
        const user = yield prisma_1.default.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
        const userAccounts = yield prisma_1.default.account.findMany({ where: { id: { in: (user === null || user === void 0 ? void 0 : user.accountIds) || [] } } });
        // Condition 0 : Le montant sollicité S ne peut pas dépasser le Solde NFS disponible (Somme des comptes EPARGNE de TOUS les membres)
        const epargneAggregate = yield prisma_1.default.account.aggregate({
            where: { type: 'EPARGNE' },
            _sum: { currentBalance: true }
        });
        const soldeNfsGlobal = Number(epargneAggregate._sum.currentBalance || 0);
        if (soldeNfsGlobal > 0 && amount > soldeNfsGlobal) {
            throw new TransactionError(`Le montant sollicité ne peut pas dépasser le solde NFS disponible (${Math.floor(soldeNfsGlobal).toLocaleString('fr-FR')} FCFA).`, 'EXCEEDS_NFS_BALANCE', 400);
        }
        const computedAccounts = (0, computeAvalise_1.computeAvalise)(userAccounts);
        const avaliseAcc = computedAccounts.find((a) => a.type === 'AVALISE');
        const cAvalAtRequest = Math.max(0, Number((avaliseAcc === null || avaliseAcc === void 0 ? void 0 : avaliseAcc.currentBalance) || 0));
        // 2. Application de la Matrice d'Éligibilité des 3 Cas
        // CAS 3: C_aval < 1/3 * S => Rejet immédiat
        if (cAvalAtRequest < (1 / 3) * amount) {
            throw new TransactionError("Vous n'êtes pas éligible pour la demande de crédit", 'NOT_ELIGIBLE', 400);
        }
        const requestedAutoAvalise = Boolean(payload.isAutoAvalise);
        let isAutoAvalise = false;
        let amountToGuarantee = amount;
        // CAS 1: C_aval >= S => Option Auto-avalise 100% avec taux bonifié
        if (cAvalAtRequest >= amount) {
            if (requestedAutoAvalise) {
                isAutoAvalise = true;
                amountToGuarantee = 0;
                rate = Math.max(0, Number((rate - 0.5).toFixed(2))); // Taux bonifié
            }
            else {
                amountToGuarantee = Math.max(0, amount - cAvalAtRequest);
            }
        }
        else {
            // CAS 2: 1/3 * S <= C_aval < S => Garanties requises = S - C_aval
            isAutoAvalise = false;
            amountToGuarantee = Math.max(0, amount - cAvalAtRequest);
        }
        // 3. Calcul de l'annuité constante M et intérêt total
        let monthlyInstallment = 0;
        let totalInterest = 0;
        if (rate === 0) {
            monthlyInstallment = Math.ceil(amount / durationMonths);
            totalInterest = 0;
        }
        else {
            totalInterest = Math.round(amount * (rate / 100) * durationMonths);
            monthlyInstallment = Math.ceil((amount + totalInterest) / durationMonths);
        }
        const avalistes = Array.isArray(payload.avalistes) ? payload.avalistes.slice(0, 5) : [];
        const pendingLoan = yield prisma_1.default.loan.findFirst({
            where: { userId, status: { in: ['PENDING', 'PENDING_COMEX', 'PENDING_AVALISTS'] } },
            select: { id: true }
        });
        if (pendingLoan)
            throw new TransactionError('Une demande de credit est deja en attente.', 'PENDING_LOAN_EXISTS', 409);
        return {
            type,
            payload: {
                amount,
                creditTypeCode,
                interestRate: rate,
                durationMonths,
                cAvalAtRequest,
                isAutoAvalise,
                amountToGuarantee,
                monthlyInstallment,
                totalInterest,
                purpose: String(payload.purpose || `Credit ${creditTypeCode || 'NFS'}`).trim().slice(0, 200),
                avalistes,
            },
            summary: `Demande de credit ${creditTypeCode || ''} de ${amount.toLocaleString('fr-FR')} XAF sur ${durationMonths} mois (${rate}%)`,
        };
    }
    if (type === 'AVALISE_CREDIT') {
        const transactionId = objectIdValue(payload.transactionId, 'Demande de credit');
        const amount = amountValue(payload.amount);
        const transaction = yield prisma_1.default.transaction.findUnique({ where: { id: transactionId } });
        if (!transaction || transaction.status !== 'PENDING' || !String(transaction.purpose || '').includes('CREDIT') || !transaction.userId) {
            throw new TransactionError('Demande de credit indisponible.', 'CREDIT_UNAVAILABLE', 404);
        }
        if (transaction.userId === userId)
            throw new TransactionError('Vous ne pouvez pas avaliser votre propre credit.', 'SELF_GUARANTEE', 403);
        const [borrower, capacityData] = yield Promise.all([
            prisma_1.default.user.findUnique({ where: { id: transaction.userId }, select: { referredById: true } }),
            getAvaliseCapacity(prisma_1.default, userId),
        ]);
        if (!borrower || borrower.referredById !== userId) {
            throw new TransactionError('Cette demande ne fait pas partie de votre reseau autorise.', 'GUARANTEE_NOT_ALLOWED', 403);
        }
        const operation = transaction.operation || {};
        const remainingGuarantee = Math.max(0, Number(transaction.amount || 0) - Number(operation.amountEndorsed || 0));
        if (amount > remainingGuarantee)
            throw new TransactionError('Le montant depasse la garantie restante.', 'GUARANTEE_AMOUNT_TOO_HIGH', 409);
        if (amount > capacityData.capacity)
            throw new TransactionError("Capacite d'avalise insuffisante.", 'INSUFFICIENT_GUARANTEE_CAPACITY', 409);
        return {
            type,
            payload: { transactionId, borrowerUserId: transaction.userId, amount },
            summary: `Avalise de ${amount.toLocaleString('fr-FR')} XAF pour la demande ...${transactionId.slice(-6)}`,
        };
    }
    if (type === 'COTISATION_JOIN' || type === 'COTISATION_PAYMENT') {
        const groupId = objectIdValue(payload.groupId, 'Groupe de cotisation');
        const group = yield prisma_1.default.cotisationGroup.findUnique({ where: { id: groupId } });
        if (!group) {
            throw new TransactionError('Groupe de cotisation introuvable.', 'GROUP_UNAVAILABLE', 404);
        }
        const rawMemberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
        const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
        const max = group.maxParticipants || group.limit_participant || 10;
        if (type === 'COTISATION_JOIN') {
            if (memberIds.includes(userId))
                throw new TransactionError('Vous etes deja membre de ce groupe.', 'ALREADY_MEMBER', 409);
            if (memberIds.length >= max) {
                throw new TransactionError('Ce groupe est complet.', 'GROUP_FULL', 409);
            }
            return {
                type,
                payload: { groupId, expectedMemberCount: memberIds.length },
                summary: `Adhesion a la cotisation ${String(group.name).slice(0, 80)}`,
            };
        }
        if (!memberIds.includes(userId))
            throw new TransactionError('Vous ne faites pas partie de ce groupe.', 'NOT_A_MEMBER', 403);
        const amount = amountValue(group.amount);
        return {
            type,
            payload: { groupId, amount },
            summary: `Cotisation ${String(group.name).slice(0, 80)} : ${amount.toLocaleString('fr-FR')} XAF`,
        };
    }
    if (type === 'ACCOUNT_FUNDING' || type === 'ACCOUNT_FUNDING_STRIPE') {
        const amount = amountValue(payload.amount);
        const targetAccountType = accountType(payload.targetAccountType || 'PRINCIPAL');
        const label = targetAccountType === 'EPARGNE' ? 'Solde Épargne' : 'Wallet NFS';
        return {
            type,
            payload: {
                amount,
                targetAccountType,
                provider: String(payload.provider || 'STRIPE'),
            },
            summary: `Approvisionnement ${label} de ${amount.toLocaleString('fr-FR')} XAF via Stripe`,
        };
    }
    if (type === 'COTISATION_PAYMENT_STRIPE') {
        const groupId = objectIdValue(payload.groupId, 'Groupe de cotisation');
        const group = yield prisma_1.default.cotisationGroup.findUnique({ where: { id: groupId } });
        if (!group || !['ACTIF', 'ACTIVE'].includes(String(group.status).toUpperCase())) {
            throw new TransactionError('Groupe de cotisation indisponible.', 'GROUP_UNAVAILABLE', 404);
        }
        const amount = amountValue(payload.amount || group.amount);
        return {
            type,
            payload: { groupId, amount, provider: 'STRIPE' },
            summary: `Cotisation ${String(group.name).slice(0, 80)} par Stripe : ${amount.toLocaleString('fr-FR')} XAF`,
        };
    }
    throw new TransactionError('Type de transaction non pris en charge.', 'UNSUPPORTED_TRANSACTION_TYPE');
});
exports.prepareTransactionPayload = prepareTransactionPayload;
const executeTransactionIntent = (intent) => __awaiter(void 0, void 0, void 0, function* () {
    const payload = intent.payload;
    if (intent.type === 'INTERNAL_TRANSFER') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const source = yield getOwnedAccount(tx, intent.userId, payload.sourceAccountType);
            const target = yield getOwnedAccount(tx, intent.userId, payload.targetAccountType);
            yield debit(tx, source.id, payload.amount);
            yield credit(tx, target.id, payload.amount);
            if (payload.targetAccountType === 'EPARGNE') {
                yield tx.systemBalance.upsert({
                    where: { code: 'NFS_GLOBAL' },
                    create: { code: 'NFS_GLOBAL', totalSavings: payload.amount, availableLiquidity: payload.amount },
                    update: { totalSavings: { increment: payload.amount }, availableLiquidity: { increment: payload.amount }, lastUpdated: new Date() },
                });
            }
            const reference = `TI_${intent.id}`;
            const outgoing = yield tx.transaction.create({
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
            yield tx.transaction.create({
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
            const txResult = { transactionId: outgoing.id, reference, status: 'SUCCESS' };
            prisma_1.default.user.findUnique({ where: { id: intent.userId }, select: { email: true, firstName: true, lastName: true } })
                .then((u) => {
                if (u === null || u === void 0 ? void 0 : u.email) {
                    const title = payload.targetAccountType === 'EPARGNE' ? 'Approvisionnement Solde Épargne' : 'Transfert Interne NFS';
                    (0, mailer_1.sendTransactionInvoiceEmail)({
                        userEmail: u.email,
                        userName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
                        transactionRef: reference,
                        title,
                        amount: payload.amount,
                        currency: source.currency || 'XAF',
                        paymentMethod: 'Solde Wallet NFS',
                    }).catch((err) => console.error('[Invoice Email Send Error]:', err));
                }
            })
                .catch((err) => console.error('[Invoice User Fetch Error]:', err));
            return txResult;
        }));
    }
    if (intent.type === 'WALLET_TRANSFER') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const source = yield getOwnedAccount(tx, intent.userId, payload.sourceAccountType);
            const target = yield getOwnedAccount(tx, payload.recipientUserId, payload.targetAccountType);
            const currentFees = yield (0, adminController_1.calculateTransferFee)(payload.amount, source.currency || 'XAF');
            if (currentFees.fee !== payload.fee) {
                throw new TransactionError('Les frais ont change. Creez une nouvelle autorisation.', 'TRANSACTION_DATA_CHANGED', 409);
            }
            const totalDebit = payload.amount + payload.fee;
            yield debit(tx, source.id, totalDebit);
            yield credit(tx, target.id, payload.amount);
            const reference = `TI_${intent.id}`;
            const outgoing = yield tx.transaction.create({
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
            yield tx.transaction.create({
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
        }));
    }
    if (intent.type === 'LOAN_REQUEST') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const pendingLoan = yield tx.loan.findFirst({
                where: { userId: intent.userId, status: { in: ['PENDING', 'PENDING_COMEX', 'PENDING_AVALISTS'] } },
                select: { id: true }
            });
            if (pendingLoan)
                throw new TransactionError('Une demande de credit est deja en attente.', 'PENDING_LOAN_EXISTS', 409);
            const reference = `LOAN_${intent.id}`;
            const initialStatus = 'PENDING_COMEX';
            const borrowerPurpose = String(payload.purpose || `Demande de crédit ${payload.creditTypeCode || 'NFS'}`).replace(/^(CREDIT|LOAN)\s*[-:]\s*/i, '').trim();
            const transaction = yield tx.transaction.create({
                data: {
                    userId: intent.userId,
                    purpose: borrowerPurpose,
                    amount: payload.amount,
                    status: initialStatus,
                    transactionRef: reference,
                    targetAccountType: 'CREDIT',
                    currency: 'XAF',
                    createdBy: 'TransactionAuthorization',
                    operation: {
                        type: 'loan_request',
                        intentId: intent.id,
                        durationMonths: payload.durationMonths,
                        creditTypeCode: payload.creditTypeCode,
                        cAvalAtRequest: payload.cAvalAtRequest,
                        isAutoAvalise: payload.isAutoAvalise,
                        amountToGuarantee: payload.amountToGuarantee,
                        avalistes: payload.avalistes
                    },
                },
            });
            const loan = yield tx.loan.create({
                data: {
                    userId: intent.userId,
                    transactionId: transaction.id,
                    amount: payload.amount,
                    duration: payload.durationMonths,
                    purpose: payload.purpose,
                    interestRate: payload.interestRate || 5,
                    totalInterest: payload.totalInterest || 0,
                    cAvalAtRequest: payload.cAvalAtRequest,
                    isAutoAvalise: payload.isAutoAvalise || false,
                    amountToGuarantee: payload.amountToGuarantee,
                    status: initialStatus,
                    avalistes: payload.avalistes,
                    createdBy: 'TransactionAuthorization',
                },
            });
            return { transactionId: transaction.id, loanId: loan.id, reference, status: initialStatus };
        }));
    }
    if (intent.type === 'AVALISE_CREDIT') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const transaction = yield tx.transaction.findUnique({ where: { id: payload.transactionId } });
            if (!transaction || transaction.status !== 'PENDING' || transaction.userId !== payload.borrowerUserId) {
                throw new TransactionError('La demande de credit a change.', 'TRANSACTION_DATA_CHANGED', 409);
            }
            const borrower = yield tx.user.findUnique({ where: { id: payload.borrowerUserId }, select: { referredById: true } });
            if (!borrower || borrower.referredById !== intent.userId) {
                throw new TransactionError('Cette demande ne fait plus partie de votre reseau autorise.', 'GUARANTEE_NOT_ALLOWED', 403);
            }
            const capacityData = yield getAvaliseCapacity(tx, intent.userId);
            if (payload.amount > capacityData.capacity) {
                throw new TransactionError("Capacite d'avalise insuffisante.", 'INSUFFICIENT_GUARANTEE_CAPACITY', 409);
            }
            const operation = transaction.operation || {};
            const currentAmountEndorsed = Number(operation.amountEndorsed || 0);
            const remainingGuarantee = Math.max(0, Number(transaction.amount || 0) - currentAmountEndorsed);
            if (payload.amount > remainingGuarantee) {
                throw new TransactionError('Le montant depasse la garantie restante.', 'TRANSACTION_DATA_CHANGED', 409);
            }
            let liabilityAccount = capacityData.accounts.find((account) => account.type === 'CREDIT_AVALISE');
            if (liabilityAccount) {
                liabilityAccount = yield credit(tx, liabilityAccount.id, payload.amount);
            }
            else {
                liabilityAccount = yield tx.account.create({
                    data: { type: 'CREDIT_AVALISE', currency: 'XAF', currentBalance: payload.amount, availableBalance: payload.amount },
                });
                yield tx.user.update({ where: { id: intent.userId }, data: { accountIds: { push: liabilityAccount.id } } });
            }
            const guarantor = yield tx.user.findUnique({ where: { id: intent.userId }, select: { firstName: true, lastName: true } });
            const guarantorName = `${(guarantor === null || guarantor === void 0 ? void 0 : guarantor.firstName) || ''} ${(guarantor === null || guarantor === void 0 ? void 0 : guarantor.lastName) || ''}`.trim() || 'Avaliste NFS';
            const avalistes = Array.isArray(operation.avalistes) ? [...operation.avalistes] : [];
            const existingIndex = avalistes.findIndex((entry) => entry.userId === intent.userId);
            if (existingIndex >= 0) {
                avalistes[existingIndex] = Object.assign(Object.assign({}, avalistes[existingIndex]), { amount: Number(avalistes[existingIndex].amount || 0) + payload.amount, date: new Date().toISOString() });
            }
            else {
                avalistes.push({ userId: intent.userId, name: guarantorName, amount: payload.amount, date: new Date().toISOString() });
            }
            const amountEndorsed = currentAmountEndorsed + payload.amount;
            const newStatus = amountEndorsed >= Number(transaction.amount || 0) ? 'VALIDATED' : 'PENDING';
            const validatedBy = transaction.validatedBy || [];
            yield tx.transaction.update({
                where: { id: transaction.id },
                data: Object.assign({ operation: Object.assign(Object.assign({}, operation), { amountEndorsed, avalistes, lastAvaliseIntentId: intent.id }), status: newStatus }, (!validatedBy.includes(intent.userId) ? { validatedBy: { push: intent.userId } } : {})),
            });
            const loan = yield tx.loan.findFirst({
                where: { OR: [{ transactionId: transaction.id }, { userId: payload.borrowerUserId, status: 'PENDING' }] },
            });
            if (loan) {
                yield tx.loan.update({ where: { id: loan.id }, data: { avalistes, status: newStatus } });
            }
            return {
                transactionId: transaction.id,
                amount: payload.amount,
                remainingGuarantee: Math.max(0, remainingGuarantee - payload.amount),
                liabilityAccountId: liabilityAccount.id,
                status: newStatus,
            };
        }));
    }
    if (intent.type === 'COTISATION_JOIN') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const group = yield tx.cotisationGroup.findUnique({ where: { id: payload.groupId } });
            if (!group)
                throw new TransactionError('Groupe introuvable.', 'GROUP_UNAVAILABLE', 404);
            const rawMemberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
            const memberIds = Array.from(new Set(rawMemberIds.map(id => String(id))));
            const max = group.maxParticipants || group.limit_participant || 10;
            if (memberIds.includes(intent.userId))
                throw new TransactionError('Adhesion deja traitee ou vous etes deja membre.', 'GROUP_STATE_CHANGED', 409);
            if (memberIds.length >= max) {
                throw new TransactionError('Ce groupe est complet.', 'GROUP_FULL', 409);
            }
            const updatedMemberIds = [...memberIds, intent.userId];
            const newStatus = updatedMemberIds.length >= max ? 'ACTIF' : 'EN_ATTENTE';
            yield tx.cotisationGroup.update({
                where: { id: group.id },
                data: {
                    memberIds: updatedMemberIds,
                    nb_participant: updatedMemberIds.length,
                    status: newStatus,
                },
            });
            return { groupId: group.id, status: 'SUCCESS' };
        }));
    }
    if (intent.type === 'COTISATION_PAYMENT') {
        return prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            const group = yield tx.cotisationGroup.findUnique({ where: { id: payload.groupId } });
            if (!group || !group.memberIds.includes(intent.userId) || group.amount !== payload.amount) {
                throw new TransactionError('Les donnees de la cotisation ont change.', 'TRANSACTION_DATA_CHANGED', 409);
            }
            const reference = `COT_${intent.id}`;
            const periodKey = contributionPeriodKey(group.frequency);
            const existingPayment = yield tx.cotisationPayment.findFirst({
                where: { userId: intent.userId, groupId: group.id, periodKey },
                select: { id: true },
            });
            if (existingPayment)
                throw new TransactionError('La cotisation de cette periode est deja payee.', 'CONTRIBUTION_ALREADY_PAID', 409);
            yield tx.cotisationPayment.create({
                data: { userId: intent.userId, groupId: group.id, periodKey, amount: payload.amount, transactionRef: reference },
            });
            const source = yield getOwnedAccount(tx, intent.userId, 'PRINCIPAL');
            yield debit(tx, source.id, payload.amount);
            yield tx.systemBalance.upsert({
                where: { code: 'NFS_GLOBAL' },
                create: { code: 'NFS_GLOBAL', totalSavings: payload.amount, availableLiquidity: payload.amount },
                update: { totalSavings: { increment: payload.amount }, availableLiquidity: { increment: payload.amount }, lastUpdated: new Date() },
            });
            const transaction = yield tx.transaction.create({
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
        }));
    }
    if (intent.type === 'ACCOUNT_FUNDING' || intent.type === 'ACCOUNT_FUNDING_STRIPE') {
        return {
            status: 'OTP_CONFIRMED',
            authorized: true,
            amount: payload.amount,
            targetAccountType: payload.targetAccountType,
        };
    }
    if (intent.type === 'COTISATION_PAYMENT_STRIPE') {
        return {
            status: 'OTP_CONFIRMED',
            authorized: true,
            amount: payload.amount,
            groupId: payload.groupId,
        };
    }
    throw new TransactionError('Type de transaction non pris en charge.', 'UNSUPPORTED_TRANSACTION_TYPE');
});
exports.executeTransactionIntent = executeTransactionIntent;
