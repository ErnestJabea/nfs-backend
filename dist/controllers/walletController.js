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
exports.getTransactions = exports.lookupUserByAccountNumber = exports.transferPreview = exports.transfer = exports.getWallets = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const computeAvalise_1 = require("../utils/computeAvalise");
const adminController_1 = require("./adminController");
const getWallets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma_1.default.user.findUnique({
            where: { id: req.user.userId }
        });
        if (!user)
            return res.json([]);
        const accounts = yield prisma_1.default.account.findMany({
            where: { id: { in: user.accountIds || [] } }
        });
        const computedAccounts = (0, computeAvalise_1.computeAvalise)(accounts);
        res.json(computedAccounts);
    }
    catch (error) {
        console.error('getWallets error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getWallets = getWallets;
const transfer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const sender = yield prisma_1.default.user.findUnique({
            where: { id: senderId }
        });
        if (!sender) {
            return res.status(404).json({ error: "Expéditeur introuvable." });
        }
        const normalizedAccountNumber = String(recipientAccountNumber).trim().toUpperCase();
        const recipient = yield prisma_1.default.user.findUnique({
            where: { accountNumber: normalizedAccountNumber }
        });
        if (!recipient) {
            return res.status(404).json({ error: `Destinataire avec le numéro de compte ${recipientAccountNumber} introuvable.` });
        }
        if (recipient.id === sender.id) {
            return res.status(400).json({ error: "Vous ne pouvez pas effectuer un transfert vers votre propre compte." });
        }
        // 2. Récupérer les comptes associés
        const senderAccounts = yield prisma_1.default.account.findMany({
            where: { id: { in: sender.accountIds || [] } }
        });
        const recipientAccounts = yield prisma_1.default.account.findMany({
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
        const feeDetails = yield (0, adminController_1.calculateTransferFee)(transferAmount, senderCurrency);
        const fee = feeDetails.fee;
        // Vérifier le solde disponible (montant + frais)
        const totalRequired = transferAmount + fee;
        if (senderSourceAccount.availableBalance < totalRequired) {
            return res.status(400).json({
                error: `Solde insuffisant pour couvrir le transfert et les frais. Requis : ${totalRequired} ${senderCurrency}, Disponible : ${senderSourceAccount.availableBalance} ${senderCurrency}`
            });
        }
        // 4. Effectuer le transfert de manière atomique (Prisma transaction)
        const result = yield prisma_1.default.$transaction((tx) => __awaiter(void 0, void 0, void 0, function* () {
            // Déduire le montant chez l'expéditeur (montant + frais)
            yield tx.account.update({
                where: { id: senderSourceAccount.id },
                data: {
                    currentBalance: { decrement: totalRequired },
                    availableBalance: { decrement: totalRequired }
                }
            });
            // Ajouter le montant chez le destinataire
            yield tx.account.update({
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
            const senderTx = yield tx.transaction.create({
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
            const recipientTx = yield tx.transaction.create({
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
        }));
        return res.status(200).json({
            message: "Transfert effectué avec succès.",
            data: result
        });
    }
    catch (error) {
        console.error('transfer error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.transfer = transfer;
const transferPreview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { recipientAccountNumber, amount, sourceAccountType = 'PRINCIPAL', targetAccountType = 'PRINCIPAL' } = req.body;
        const senderId = req.user.userId;
        const transferAmount = Number(amount) || 0;
        // 1. Rechercher l'expéditeur
        const sender = yield prisma_1.default.user.findUnique({
            where: { id: senderId }
        });
        if (!sender) {
            return res.status(404).json({ error: "Expéditeur introuvable." });
        }
        // 2. Récupérer les comptes de l'expéditeur
        const senderAccounts = yield prisma_1.default.account.findMany({
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
            const feeDetails = yield (0, adminController_1.calculateTransferFee)(transferAmount, senderCurrency);
            fee = feeDetails.fee;
            feeRate = feeDetails.rate;
            flatFee = feeDetails.flatFee;
        }
        const totalRequired = transferAmount + fee;
        // 4. Déterminer le destinataire et sa devise
        let destCurrencyCode = senderCurrency;
        let recipientName = null;
        let isDifferent = false;
        let conversionRate = 1.0;
        let convertedAmount = transferAmount;
        if (recipientAccountNumber) {
            const normalizedAccountNumber = String(recipientAccountNumber).trim().toUpperCase();
            const recipient = yield prisma_1.default.user.findUnique({
                where: { accountNumber: normalizedAccountNumber }
            });
            if (recipient) {
                recipientName = `${recipient.firstName} ${recipient.lastName}`.toUpperCase();
                const recipientAccounts = yield prisma_1.default.account.findMany({
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
            const sourceCurrency = yield prisma_1.default.currency.findUnique({ where: { code: senderCurrency } });
            const destCurrency = yield prisma_1.default.currency.findUnique({ where: { code: destCurrencyCode } });
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
    }
    catch (error) {
        console.error('transferPreview error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.transferPreview = transferPreview;
const lookupUserByAccountNumber = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { accountNumber } = req.params;
        if (!accountNumber) {
            return res.status(400).json({ error: "Numéro de compte requis." });
        }
        const normalizedAccountNumber = String(accountNumber).trim().toUpperCase();
        const user = yield prisma_1.default.user.findUnique({
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
    }
    catch (error) {
        console.error('lookupUserByAccountNumber error:', error);
        return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.lookupUserByAccountNumber = lookupUserByAccountNumber;
const getTransactions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const transactions = yield prisma_1.default.transaction.findMany({
            where: {
                userId: req.user.userId,
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(transactions);
    }
    catch (error) {
        console.error('getTransactions error:', error);
        res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Server error' : error.message });
    }
});
exports.getTransactions = getTransactions;
