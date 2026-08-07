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
exports.avaliseTransaction = exports.getCreditByCode = exports.getCreditById = exports.getCreditsPublic = exports.createTransaction = exports.generateInvoice = exports.getCumulCredit = exports.getEligibleCreditsForAvalise = exports.getCreditListPending = exports.getUserTransactions = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const requestAccess_1 = require("../utils/requestAccess");
const mapTransaction = (t) => {
    var _a, _b, _c;
    const operation = t.operation || {};
    const avaliste = operation.avalistes || operation.avaliste || t.avalistes || t.avaliste || [];
    return Object.assign(Object.assign({}, t), { id: t.id, _id: t.id, user: t.userId, destinationAmount: t.amount || 0, originAmount: t.amount || 0, originCurrency: t.currency || "XAF", destinationCurrency: t.currency || "XAF", status: t.status || "PENDING", transactionRef: t.transactionRef || "", createdAt: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString(), operation: operation, beneficiary: t.beneficiary || null, userFirstName: (_a = t.user) === null || _a === void 0 ? void 0 : _a.firstName, userLastName: (_b = t.user) === null || _b === void 0 ? void 0 : _b.lastName, amountEndorsed: operation.amountEndorsed || ((_c = t.validatedBy) === null || _c === void 0 ? void 0 : _c.length) || 0, avaliste: avaliste, avalistes: avaliste, interestRate: operation.interestRate || t.interestRate || Number(process.env.DEFAULT_LOAN_INTEREST_RATE || 5) });
};
const getUserTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.params.userId || req.query.userId || (0, requestAccess_1.getRequestUserId)(req);
        if (!userId)
            return res.status(400).json({ error: "User ID required" });
        if (!(0, requestAccess_1.canAccessUser)(req, userId)) {
            return res.status(403).json({ error: "Acces refuse aux transactions de cet utilisateur." });
        }
        const transactions = yield prisma_1.default.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json({ data: transactions.map(mapTransaction) });
    }
    catch (error) {
        console.error('getUserTransactions error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getUserTransactions = getUserTransactions;
const getCreditListPending = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requesterValue = (0, requestAccess_1.getRequestUserId)(req);
        if (!requesterValue)
            return res.status(401).json({ error: 'Session invalide.' });
        const requesterId = String(requesterValue);
        // Récupérer uniquement les demandes de crédit de l'utilisateur connecté
        const loans = yield prisma_1.default.loan.findMany({
            where: { userId: requesterId },
            orderBy: { createdAt: 'desc' }
        });
        const mapped = loans.map((loan) => ({
            id: loan.id,
            amount: loan.amount,
            interestRate: loan.interestRate,
            duration_months: loan.duration,
            purpose: loan.purpose,
            status: loan.status,
            avalistes: loan.avalistes || [],
            createdAt: loan.createdAt,
            updatedAt: loan.updatedAt,
            operation: {
                interestRate: loan.interestRate,
                durationMonths: loan.duration,
                avalistes: loan.avalistes || []
            }
        }));
        res.json({ data: mapped });
    }
    catch (error) {
        console.error('getCreditListPending error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCreditListPending = getCreditListPending;
const getEligibleCreditsForAvalise = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const requesterId = (0, requestAccess_1.getRequestUserId)(req);
        if (!requesterId)
            return res.status(401).json({ error: 'Session invalide.' });
        const referrals = yield prisma_1.default.user.findMany({
            where: { referredById: requesterId },
            select: { id: true, firstName: true, lastName: true },
        });
        if (!referrals.length)
            return res.json({ data: [] });
        const borrowerById = new Map(referrals.map((user) => [
            user.id,
            `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Filleul NFS',
        ]));
        const transactions = yield prisma_1.default.transaction.findMany({
            where: {
                userId: { in: referrals.map((user) => user.id) },
                status: 'PENDING',
                purpose: { contains: 'CREDIT' },
            },
            orderBy: { createdAt: 'desc' },
        });
        const eligible = transactions
            .filter((transaction) => { var _a; return !String(((_a = transaction.operation) === null || _a === void 0 ? void 0 : _a.code) || '').includes('AUTO'); })
            .map((transaction) => {
            const operation = transaction.operation || {};
            const totalAmount = Number(transaction.amount || 0);
            const amountEndorsed = Number(operation.amountEndorsed || 0);
            return {
                id: transaction.id,
                borrowerName: borrowerById.get(String(transaction.userId)) || 'Filleul NFS',
                purpose: transaction.purpose,
                amount: totalAmount,
                amountEndorsed,
                remainingGuarantee: Math.max(0, totalAmount - amountEndorsed),
                currency: transaction.currency || 'XAF',
                createdAt: transaction.createdAt,
            };
        })
            .filter((transaction) => transaction.remainingGuarantee > 0);
        return res.json({ data: eligible });
    }
    catch (error) {
        console.error('getEligibleCreditsForAvalise error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getEligibleCreditsForAvalise = getEligibleCreditsForAvalise;
const getCumulCredit = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = String(req.params.userId || '');
        const { status } = req.query; // PENDING or SUCCESS
        if (!(0, requestAccess_1.canAccessUser)(req, userId)) {
            return res.status(403).json({ error: "Acces refuse a cet utilisateur." });
        }
        const transactions = yield prisma_1.default.transaction.findMany({
            where: {
                userId: userId,
                status: status || "SUCCESS",
                purpose: { contains: "CREDIT" }
            }
        });
        const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
        res.json({ data: total.toString() });
    }
    catch (error) {
        console.error('getCumulCredit error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCumulCredit = getCumulCredit;
const generateInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Mocking PDF response for now
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from("PDF Fake Content"));
});
exports.generateInvoice = generateInvoice;
const createTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { operationCode, userId, amount, beneficiary } = req.body;
        const authUserId = (0, requestAccess_1.getRequestUserId)(req);
        const finalUserId = userId || authUserId;
        if (!finalUserId)
            return res.status(400).json({ error: "User ID required" });
        if (!(0, requestAccess_1.canAccessUser)(req, finalUserId)) {
            return res.status(403).json({ error: "Vous ne pouvez pas creer une transaction pour un autre utilisateur." });
        }
        // Enregistrement de l'emprunt
        const transaction = yield prisma_1.default.transaction.create({
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
            const config = yield prisma_1.default.loanConfig.findFirst({ where: { code: operationCode } });
            const defaultRate = Number(process.env.DEFAULT_LOAN_INTEREST_RATE || 5);
            const interestRate = (config && typeof config.rate === 'number' && config.rate > 0) ? config.rate : defaultRate;
            const durationMonths = config ? Math.ceil(config.duration / 30) : 6;
            yield prisma_1.default.loan.create({
                data: {
                    userId: finalUserId,
                    amount: Number(amount) || 0,
                    interestRate: interestRate,
                    totalInterest: Math.round((Number(amount) || 0) * (interestRate / 100) * durationMonths),
                    duration: durationMonths,
                    purpose: operationCode || "CREDIT",
                    status: "PENDING",
                    avalistes: beneficiary ? [beneficiary] : [],
                    createdBy: "System"
                }
            });
        }
        catch (loanError) {
            console.error("Erreur creation de l'objet Loan dans la base de donnees:", loanError);
        }
        // Optionnel: Envoyer l'email au COMEX
        try {
            const { sendMail } = require('../utils/sendMail');
            const user = yield prisma_1.default.user.findUnique({ where: { id: finalUserId } });
            const comexEmail = "comex@ndfashion.com"; // ou l'email admin
            const subject = "[NFS] Nouvelle demande de crédit en attente de validation";
            const html = `
        <h3>Nouvelle demande de Crédit</h3>
        <p><strong>Utilisateur :</strong> ${user === null || user === void 0 ? void 0 : user.firstName} ${user === null || user === void 0 ? void 0 : user.lastName}</p>
        <p><strong>Montant :</strong> ${amount} XAF</p>
        <p><strong>Type de crédit :</strong> ${operationCode}</p>
        <p>Veuillez vous connecter au backoffice pour valider cette demande.</p>
      `;
            yield sendMail(comexEmail, subject, html);
        }
        catch (mailError) {
            console.error("Erreur envoi email COMEX:", mailError);
        }
        return res.status(200).json({ message: "Success", data: mapTransaction(transaction) });
    }
    catch (error) {
        console.error('createTransaction error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.createTransaction = createTransaction;
const getCreditsPublic = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let configs = yield prisma_1.default.loanConfig.findMany({ orderBy: { code: 'asc' } });
        if (!configs || configs.length === 0) {
            const defaultConfigs = [
                { code: 'CLASSIQUE', rate: 3.99, duration: 30 },
                { code: 'CONS7', rate: 21.99, duration: 210 },
                { code: 'CONS8', rate: 24.99, duration: 240 },
                { code: 'CONS9', rate: 27.99, duration: 270 },
                { code: 'CT1', rate: 3.99, duration: 30 },
                { code: 'CT2', rate: 7.98, duration: 60 },
                { code: 'CT3', rate: 11.97, duration: 90 },
            ];
            yield prisma_1.default.loanConfig.createMany({ data: defaultConfigs }).catch(() => undefined);
            configs = yield prisma_1.default.loanConfig.findMany({ orderBy: { code: 'asc' } });
        }
        const mapped = configs.map(c => ({
            id: c.id,
            code: c.code,
            description: `${c.code} (${c.rate}%, ${c.duration}j)`,
            interest: c.rate,
            day: c.duration,
            durationMonths: Math.max(1, Math.round(c.duration / 30)),
            createdAt: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
            updatedAt: c.updatedAt ? c.updatedAt.toISOString() : new Date().toISOString()
        }));
        return res.json({ data: mapped });
    }
    catch (error) {
        console.error('getCreditsPublic error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCreditsPublic = getCreditsPublic;
const getCreditById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const id = String(req.params.id);
        const config = yield prisma_1.default.loanConfig.findUnique({ where: { id: id } });
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
    }
    catch (error) {
        console.error('getCreditById error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCreditById = getCreditById;
const getCreditByCode = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const code = String(req.params.code);
        const config = yield prisma_1.default.loanConfig.findFirst({ where: { code } });
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
    }
    catch (error) {
        console.error('getCreditByCode error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getCreditByCode = getCreditByCode;
const avaliseTransaction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { amount } = req.body;
        const user = (0, requestAccess_1.getRequestUserId)(req);
        if (!user) {
            return res.status(401).json({ error: "Session invalide. Veuillez vous reconnecter." });
        }
        const transaction = yield prisma_1.default.transaction.findUnique({ where: { id: id } });
        if (!transaction)
            return res.status(404).json({ error: "Transaction not found" });
        let operation = transaction.operation || {};
        let amountEndorsed = Number(operation.amountEndorsed || 0);
        amountEndorsed += Number(amount);
        let avalistes = operation.avalistes || [];
        // Calcul des intérêts (Le calcul est déjà dans le backend lors de la création, ici on enregistre juste l'apport de l'avaliste)
        // On pourrait calculer la part des intérêts si besoin, mais le total est déjà dans totalInterest.
        const existingAvalisteIndex = avalistes.findIndex((a) => a.userId === user);
        if (existingAvalisteIndex !== -1) {
            avalistes[existingAvalisteIndex].amount += Number(amount);
            avalistes[existingAvalisteIndex].date = new Date().toISOString();
        }
        else {
            const userObj = yield prisma_1.default.user.findUnique({ where: { id: user } });
            const fullName = userObj ? (userObj.firstName + ' ' + userObj.lastName) : 'Inconnu';
            avalistes.push({ userId: user, amount: Number(amount), date: new Date().toISOString(), name: fullName });
        }
        operation = Object.assign(Object.assign({}, operation), { amountEndorsed, avalistes });
        let newStatus = transaction.status;
        if (amountEndorsed >= Number(transaction.amount || 0)) {
            newStatus = "VALIDATED";
        }
        const validatedBy = transaction.validatedBy || [];
        const updateData = {
            operation: operation,
            status: newStatus || "PENDING"
        };
        if (!validatedBy.includes(user)) {
            updateData.validatedBy = { push: user };
        }
        const updated = yield prisma_1.default.transaction.update({
            where: { id: id },
            data: updateData
        });
        // Mettre à jour l'objet Loan correspondant
        if (transaction.userId) {
            const loan = yield prisma_1.default.loan.findFirst({
                where: { userId: transaction.userId, status: "PENDING" }
            });
            if (loan) {
                yield prisma_1.default.loan.update({
                    where: { id: loan.id },
                    data: {
                        avalistes: avalistes,
                        status: newStatus || "PENDING"
                    }
                });
            }
        }
        res.json({ data: mapTransaction(updated) });
    }
    catch (error) {
        console.error('Avalise error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.avaliseTransaction = avaliseTransaction;
