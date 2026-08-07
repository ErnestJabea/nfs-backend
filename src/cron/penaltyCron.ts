import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Exécuter tous les jours à minuit
export const startPenaltyCron = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('CRON: Démarrage du calcul des pénalités de retard...');
    try {
      const today = new Date();
      // On cherche les crédits approuvés avec une date d'échéance dépassée
      const overdueLoans = await prisma.loan.findMany({
        where: {
          status: 'APPROVED',
          dueDate: {
            lt: today
          }
        }
      });

      for (const loan of overdueLoans) {
        if (!loan.dueDate) continue;
        
        // Jours de retard = Différence en ms / (1000 * 3600 * 24)
        const diffMs = today.getTime() - loan.dueDate.getTime();
        const daysLate = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (daysLate <= 3) {
          // 1. Délai de grâce (1 à 3 jours) : 0 pénalité
          await prisma.loan.update({
            where: { id: loan.id },
            data: { penaltyAmount: 0 }
          });
        } else if (daysLate <= 30) {
          // 2. Pénalité de Retard Moratoire (Jour 4 à 30) : 2.0% mensuel pro-rata temporis
          const effectiveOverdueDays = daysLate - 3;
          const monthlyRate = 0.02; // 2.0% mensuel
          const dailyRate = monthlyRate / 30;
          const newPenaltyAmount = Math.ceil(loan.amount * dailyRate * effectiveOverdueDays);

          await prisma.loan.update({
            where: { id: loan.id },
            data: { penaltyAmount: newPenaltyAmount }
          });
          
          console.log(`CRON: Pénalité moratoire calculée pour le prêt ${loan.id} - ${effectiveOverdueDays} jours post-grâce. Pénalité: ${newPenaltyAmount} FCFA`);
        } else {
          // 3. Appel aux Avalistes (Jour > 30) : Passage en statut DEFAULT
          await prisma.loan.update({
            where: { id: loan.id },
            data: { status: 'DEFAULT' }
          });
          console.log(`CRON: Prêt ${loan.id} en impayé prolonge (>30j) -> Passage au statut DEFAULT et appel de la garantie avalistes.`);
        }
      }
      console.log('CRON: Fin du calcul des pénalités.');
    } catch (error) {
      console.error('CRON: Erreur lors du calcul des pénalités', error);
    }
  });
};
