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
Object.defineProperty(exports, "__esModule", { value: true });
exports.directEpargne = exports.validateEpargne = exports.requestEpargne = void 0;
const client_1 = require("@prisma/client");
const mailService_1 = require("../services/mailService");
const requestAccess_1 = require("../utils/requestAccess");
const prisma = new client_1.PrismaClient();
const requestEpargne = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount } = req.body;
        const requestedUserId = req.body.userId;
        const userId = requestedUserId || (0, requestAccess_1.getRequestUserId)(req);
        if (!userId || !amount) {
            return res.status(400).json({ error: "userId and amount are required" });
        }
        if (!(0, requestAccess_1.canAccessUser)(req, userId)) {
            return res.status(403).json({ error: "Vous ne pouvez pas creer une demande d'epargne pour un autre utilisateur." });
        }
        // Récupérer l'utilisateur pour l'email
        const user = yield prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        // Check balance
        const accounts = yield prisma.account.findMany({ where: { id: { in: user.accountIds || [] } } });
        const principalAcc = accounts.find((a) => a.type === 'PRINCIPAL');
        if (!principalAcc || principalAcc.availableBalance < amount) {
            return res.status(400).json({ error: `Solde principal insuffisant pour cette opération d'épargne.` });
        }
        // Récupérer tous les admins pour la notification
        const admins = yield prisma.user.findMany({
            where: { roles: { has: "ADMIN" } }
        });
        const adminEmails = admins.map(a => a.email).filter(e => e);
        const epargneAcc = accounts.find((a) => a.type === 'EPARGNE');
        if (!epargneAcc) {
            return res.status(400).json({ error: "Compte épargne introuvable." });
        }
        const dateStr = new Date().toISOString().split('T')[0].split('-').reverse().join('-');
        const transactionRef = `EPARGNE_${Date.now()}_${userId}`;
        // Exécuter la transaction atomiquement et instantanément
        const transaction = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Déduire du principal
            yield tx.account.update({
                where: { id: principalAcc.id },
                data: {
                    currentBalance: { decrement: amount },
                    availableBalance: { decrement: amount }
                }
            });
            // Ajouter à l'épargne
            yield tx.account.update({
                where: { id: epargneAcc.id },
                data: {
                    currentBalance: { increment: amount },
                    availableBalance: { increment: amount }
                }
            });
            // Mettre à jour le solde global NFS
            yield tx.systemBalance.upsert({
                where: { code: 'NFS_GLOBAL' },
                create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
                update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
            });
            // Créer la transaction SUCCESS
            return yield tx.transaction.create({
                data: {
                    userId,
                    amount,
                    status: "SUCCESS",
                    purpose: "EPARGNE",
                    sourceAccountType: "PRINCIPAL",
                    targetAccountType: "EPARGNE",
                    transactionRef: transactionRef,
                    createdBy: "System",
                    operation: {
                        type: "epargne",
                        code: `EPARGNE_${Date.now()}`,
                        reference: `${dateStr}.EP.${userId}`,
                        amount,
                        date: new Date().toISOString()
                    }
                }
            });
        }));
        // Envoyer les emails
        if (user.email) {
            yield (0, mailService_1.sendEpargneRequestMail)(user.email, `${user.firstName || ''} ${user.lastName || ''}`.trim(), amount, adminEmails);
        }
        res.status(201).json({ message: "Epargne request created", data: transaction });
    }
    catch (error) {
        console.error('requestEpargne error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.requestEpargne = requestEpargne;
const validateEpargne = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const transactionId = String(req.params.transactionId);
        const adminId = (0, requestAccess_1.getRequestUserId)(req);
        if (!adminId)
            return res.status(401).json({ error: "Unauthorized" });
        if (!(0, requestAccess_1.requestIsAdmin)(req)) {
            return res.status(403).json({ error: "Seul un administrateur peut valider une epargne." });
        }
        const transaction = yield prisma.transaction.findUnique({
            where: { id: transactionId },
            include: { user: true }
        });
        if (!transaction)
            return res.status(404).json({ error: "Transaction not found" });
        if (transaction.status === "SUCCESS" || transaction.status === "APPROVED") {
            return res.status(400).json({ error: "Transaction already validated" });
        }
        const adminUser = yield prisma.user.findUnique({ where: { id: adminId } });
        const adminName = adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : '';
        if (transaction.createdBy && adminName && transaction.createdBy === adminName) {
            return res.status(403).json({ error: "Vous ne pouvez pas valider une transaction que vous avez initiée." });
        }
        // Update Transaction
        const updatedTransaction = yield prisma.transaction.update({
            where: { id: transactionId },
            data: {
                status: "APPROVED",
                validatedBy: { push: adminId }
            }
        });
        // Envoyer email au client
        if ((_a = transaction.user) === null || _a === void 0 ? void 0 : _a.email) {
            yield (0, mailService_1.sendEpargneValidationMail)(transaction.user.email, `${transaction.user.firstName || ''} ${transaction.user.lastName || ''}`.trim(), transaction.amount || 0);
        }
        res.json({ message: "Epargne validated", data: updatedTransaction });
    }
    catch (error) {
        console.error('validateEpargne error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.validateEpargne = validateEpargne;
const directEpargne = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount } = req.body;
        const userId = (0, requestAccess_1.getRequestUserId)(req);
        if (!userId || !amount) {
            return res.status(400).json({ error: "userId and amount are required" });
        }
        const rechargeAmount = Number(amount);
        if (isNaN(rechargeAmount) || rechargeAmount <= 0) {
            return res.status(400).json({ error: "Le montant de recharge doit être un nombre positif." });
        }
        // 1. Rechercher l'utilisateur
        const user = yield prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user)
            return res.status(404).json({ error: "Utilisateur introuvable." });
        // 2. Récupérer les comptes associés
        const accounts = yield prisma.account.findMany({
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
        const result = yield prisma.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Déduire le montant du compte principal
            yield tx.account.update({
                where: { id: principalAccount.id },
                data: {
                    currentBalance: { decrement: rechargeAmount },
                    availableBalance: { decrement: rechargeAmount }
                }
            });
            // Ajouter le montant au compte d'épargne
            yield tx.account.update({
                where: { id: epargneAccount.id },
                data: {
                    currentBalance: { increment: rechargeAmount },
                    availableBalance: { increment: rechargeAmount }
                }
            });
            // Créer la transaction de débit (wallet)
            yield tx.transaction.create({
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
            // Mettre à jour le solde global NFS
            yield tx.systemBalance.upsert({
                where: { code: 'NFS_GLOBAL' },
                create: { code: 'NFS_GLOBAL', totalSavings: rechargeAmount, availableLiquidity: rechargeAmount },
                update: { totalSavings: { increment: rechargeAmount }, availableLiquidity: { increment: rechargeAmount }, lastUpdated: new Date() },
            });
            // Créer la transaction de crédit (épargne)
            const epargneTx = yield tx.transaction.create({
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
        }));
        res.status(200).json({ message: "Recharge d'épargne effectuée avec succès.", data: result });
    }
    catch (error) {
        console.error('directEpargne error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.directEpargne = directEpargne;
