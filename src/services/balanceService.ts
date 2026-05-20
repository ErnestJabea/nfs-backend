import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class BalanceService {
  /**
   * Met à jour le solde global NFS à partir d'une transaction d'épargne.
   * @param amount Le montant à ajouter (positif pour dépôt, négatif pour retrait)
   */
  static async updateNfsSavings(amount: number) {
    try {
      console.log(`[BalanceService] Mise à jour du solde global: ${amount} XAF`);
      
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
          availableLiquidity: amount,
          lastUpdated: new Date()
        }
      });

      return balance;
    } catch (error) {
      console.error('[BalanceService] Erreur lors de la mise à jour du solde:', error);
      throw error;
    }
  }

  /**
   * Recalcule complètement le solde à partir de tous les comptes EPARGNE.
   * Utile pour la synchronisation initiale ou en cas de doute.
   */
  static async syncGlobalBalance() {
    try {
      const epargneSum = await prisma.account.aggregate({
        where: { type: 'EPARGNE' },
        _sum: { availableBalance: true }
      });

      const principalSum = await prisma.account.aggregate({
        where: { type: 'PRINCIPAL' },
        _sum: { availableBalance: true }
      });

      const totalSavings = epargneSum._sum.availableBalance || 0;
      const totalPrincipal = principalSum._sum.availableBalance || 0;

      const balance = await prisma.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        update: {
          totalSavings: totalSavings,
          totalPrincipal: totalPrincipal,
          availableLiquidity: totalSavings, // On considère la liquidité comme l'épargne disponible
          lastUpdated: new Date()
        },
        create: {
          code: 'NFS_GLOBAL',
          totalSavings: totalSavings,
          totalPrincipal: totalPrincipal,
          availableLiquidity: totalSavings,
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
   * Récupère le solde global actuel.
   */
  static async getGlobalBalance() {
    let balance = await prisma.systemBalance.findUnique({
      where: { code: 'NFS_GLOBAL' }
    });

    if (!balance) {
      // Si n'existe pas encore, on le crée en synchronisant
      balance = await this.syncGlobalBalance();
    }

    return balance;
  }
}
