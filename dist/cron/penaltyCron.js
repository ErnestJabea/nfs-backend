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
exports.startPenaltyCron = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Exécuter tous les jours à minuit
const startPenaltyCron = () => {
    node_cron_1.default.schedule('0 0 * * *', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log('CRON: Démarrage du calcul des pénalités de retard...');
        try {
            const today = new Date();
            // On cherche les crédits approuvés avec une date d'échéance dépassée
            const overdueLoans = yield prisma.loan.findMany({
                where: {
                    status: 'APPROVED',
                    dueDate: {
                        lt: today
                    }
                }
            });
            for (const loan of overdueLoans) {
                if (!loan.dueDate)
                    continue;
                // Jours de retard = Différence en ms / (1000 * 3600 * 24)
                const diffMs = today.getTime() - loan.dueDate.getTime();
                const daysLate = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                if (daysLate <= 3) {
                    // 1. Délai de grâce (1 à 3 jours) : 0 pénalité
                    yield prisma.loan.update({
                        where: { id: loan.id },
                        data: { penaltyAmount: 0 }
                    });
                }
                else if (daysLate <= 30) {
                    // 2. Pénalité de Retard Moratoire (Jour 4 à 30) : 2.0% mensuel pro-rata temporis
                    const effectiveOverdueDays = daysLate - 3;
                    const monthlyRate = 0.02; // 2.0% mensuel
                    const dailyRate = monthlyRate / 30;
                    const newPenaltyAmount = Math.ceil(loan.amount * dailyRate * effectiveOverdueDays);
                    yield prisma.loan.update({
                        where: { id: loan.id },
                        data: { penaltyAmount: newPenaltyAmount }
                    });
                    console.log(`CRON: Pénalité moratoire calculée pour le prêt ${loan.id} - ${effectiveOverdueDays} jours post-grâce. Pénalité: ${newPenaltyAmount} FCFA`);
                }
                else {
                    // 3. Appel aux Avalistes (Jour > 30) : Passage en statut DEFAULT
                    yield prisma.loan.update({
                        where: { id: loan.id },
                        data: { status: 'DEFAULT' }
                    });
                    console.log(`CRON: Prêt ${loan.id} en impayé prolonge (>30j) -> Passage au statut DEFAULT et appel de la garantie avalistes.`);
                }
            }
            console.log('CRON: Fin du calcul des pénalités.');
        }
        catch (error) {
            console.error('CRON: Erreur lors du calcul des pénalités', error);
        }
    }));
};
exports.startPenaltyCron = startPenaltyCron;
