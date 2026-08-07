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
exports.BalanceService = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
class BalanceService {
    /**
     * Met à jour le solde global NFS à partir d'une transaction d'épargne.
     * @param amount Le montant à ajouter (positif pour dépôt, négatif pour retrait)
     */
    static updateNfsSavings(amount) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`[BalanceService] Mise à jour de l'épargne globale NFS : +${amount} XAF`);
                const balance = yield prisma_1.default.systemBalance.upsert({
                    where: { code: 'NFS_GLOBAL' },
                    update: {
                        totalSavings: { increment: amount },
                        availableLiquidity: { increment: amount },
                        lastUpdated: new Date()
                    },
                    create: {
                        code: 'NFS_GLOBAL',
                        totalSavings: amount,
                        totalPrincipal: 0,
                        totalLoans: 0,
                        availableLiquidity: amount,
                        lastUpdated: new Date()
                    }
                });
                return balance;
            }
            catch (error) {
                console.error('[BalanceService] Erreur lors de la mise à jour de l’épargne globale:', error);
                throw error;
            }
        });
    }
    /**
     * Débite la liquidité globale NFS lors de l'octroi d'un crédit accordé et versé à un bénéficiaire.
     * @param loanAmount Le montant du crédit accordé
     */
    static recordLoanGranted(loanAmount) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`[BalanceService] Débit Crédit Accordé : -${loanAmount} XAF sur la liquidité globale NFS`);
                const balance = yield prisma_1.default.systemBalance.upsert({
                    where: { code: 'NFS_GLOBAL' },
                    update: {
                        totalLoans: { increment: loanAmount },
                        availableLiquidity: { decrement: loanAmount },
                        lastUpdated: new Date()
                    },
                    create: {
                        code: 'NFS_GLOBAL',
                        totalSavings: 0,
                        totalPrincipal: 0,
                        totalLoans: loanAmount,
                        availableLiquidity: -loanAmount,
                        lastUpdated: new Date()
                    }
                });
                return balance;
            }
            catch (error) {
                console.error('[BalanceService] Erreur lors de l’enregistrement du crédit accordé:', error);
                throw error;
            }
        });
    }
    /**
     * Recalcule complètement le solde NFS à partir de tous les comptes EPARGNE et des Crédits Accordés.
     * Solde NFS = Total des Épargnes Collectées - Total des Crédits Accordés (APPROVED).
     */
    static syncGlobalBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const epargneSum = yield prisma_1.default.account.aggregate({
                    where: { type: 'EPARGNE' },
                    _sum: { currentBalance: true }
                });
                const principalSum = yield prisma_1.default.account.aggregate({
                    where: { type: 'PRINCIPAL' },
                    _sum: { currentBalance: true }
                });
                const approvedLoansSum = yield prisma_1.default.loan.aggregate({
                    where: { status: 'APPROVED' },
                    _sum: { amount: true }
                });
                const totalSavings = epargneSum._sum.currentBalance || 0;
                const totalPrincipal = principalSum._sum.currentBalance || 0;
                const totalLoans = approvedLoansSum._sum.amount || 0;
                // Solde NFS disponible = Épargne totale - Crédits accordés
                const availableLiquidity = totalSavings - totalLoans;
                const balance = yield prisma_1.default.systemBalance.upsert({
                    where: { code: 'NFS_GLOBAL' },
                    update: {
                        totalSavings: totalSavings,
                        totalPrincipal: totalPrincipal,
                        totalLoans: totalLoans,
                        availableLiquidity: availableLiquidity,
                        lastUpdated: new Date()
                    },
                    create: {
                        code: 'NFS_GLOBAL',
                        totalSavings: totalSavings,
                        totalPrincipal: totalPrincipal,
                        totalLoans: totalLoans,
                        availableLiquidity: availableLiquidity,
                        lastUpdated: new Date()
                    }
                });
                return balance;
            }
            catch (error) {
                console.error('[BalanceService] Erreur lors de la synchronisation:', error);
                throw error;
            }
        });
    }
    /**
     * Récupère le solde global actuel synchronisé en temps réel avec tous les comptes EPARGNE.
     */
    static getGlobalBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.syncGlobalBalance();
        });
    }
}
exports.BalanceService = BalanceService;
