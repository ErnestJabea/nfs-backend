import prisma from '../utils/prisma';

export class BalanceService {
  /**
   * Met à jour le solde global NFS à partir d'une transaction d'épargne.
   * @param amount Le montant à ajouter (positif pour dépôt, négatif pour retrait)
   */
  static async updateNfsSavings(amount: number) {
    try {
      console.log(`[BalanceService] Mise à jour de l'épargne globale NFS : +${amount} XAF`);
      
      const balance = await prisma.systemBalance.upsert({
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
    } catch (error) {
      console.error('[BalanceService] Erreur lors de la mise à jour de l’épargne globale:', error);
      throw error;
    }
  }

  /**
   * Débite la liquidité globale NFS lors de l'octroi d'un crédit accordé et versé à un bénéficiaire.
   * @param loanAmount Le montant du crédit accordé
   */
  static async recordLoanGranted(loanAmount: number) {
    try {
      console.log(`[BalanceService] Débit Crédit Accordé : -${loanAmount} XAF sur la liquidité globale NFS`);

      const balance = await prisma.systemBalance.upsert({
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
    } catch (error) {
      console.error('[BalanceService] Erreur lors de l’enregistrement du crédit accordé:', error);
      throw error;
    }
  }

  /**
   * Recalcule complètement le solde NFS à partir de tous les comptes EPARGNE et des Crédits Accordés.
   * Solde NFS = Total des Épargnes Collectées - Total des Crédits Accordés (APPROVED).
   */
  static async syncGlobalBalance() {
    try {
      const epargneSum = await prisma.account.aggregate({
        where: { type: 'EPARGNE' },
        _sum: { currentBalance: true }
      });

      const principalSum = await prisma.account.aggregate({
        where: { type: 'PRINCIPAL' },
        _sum: { currentBalance: true }
      });

      const approvedLoansSum = await prisma.loan.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true }
      });

      const totalSavings = epargneSum._sum.currentBalance || 0;
      const totalPrincipal = principalSum._sum.currentBalance || 0;
      const totalLoans = approvedLoansSum._sum.amount || 0;

      // Solde NFS disponible = Épargne totale - Crédits accordés
      const availableLiquidity = totalSavings - totalLoans;

      const balance = await prisma.systemBalance.upsert({
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
    } catch (error) {
      console.error('[BalanceService] Erreur lors de la synchronisation:', error);
      throw error;
    }
  }

  /**
   * Récupère le solde global actuel synchronisé en temps réel avec tous les comptes EPARGNE.
   */
  static async getGlobalBalance() {
    return await this.syncGlobalBalance();
  }
}
