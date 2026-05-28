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

        if (daysLate > 0) {
          // Taux de pénalité = Taux initial + 2
          const penaltyRate = (loan.interestRate || 0) + 2;
          
          // Formule: Pénalité = Montant * (Taux / 100) * (Jours / Durée du prêt en jours)
          // On assume que duration est en jours dans LoanConfig.
          const loanDuration = loan.duration || 30; 
          
          const newPenaltyAmount = loan.amount * (penaltyRate / 100) * (daysLate / loanDuration);

          await prisma.loan.update({
            where: { id: loan.id },
            data: { penaltyAmount: newPenaltyAmount }
          });
          
          console.log(`CRON: Pénalité calculée pour le prêt ${loan.id} - ${daysLate} jours de retard. Pénalité: ${newPenaltyAmount}`);
        }
      }
      console.log('CRON: Fin du calcul des pénalités.');
    } catch (error) {
      console.error('CRON: Erreur lors du calcul des pénalités', error);
    }
  });
};
