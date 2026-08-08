import prisma from '../utils/prisma';
import { verifyAndReconcileEnkapOrder, sanitizeLog } from '../services/enkapService';

/**
 * Job de réconciliation périodique Enkap (Polling de rattrapage)
 */
export const startEnkapReconciliationCron = (intervalMinutes: number = 10) => {
  console.log(`[Enkap Cron Job] Initialisation du job de réconciliation toutes les ${intervalMinutes} minutes.`);

  const runReconciliation = async () => {
    try {
      console.log('[Enkap Cron Job] Recherche des transactions Enkap en attente...');

      // Récupérer les transactions Enkap créées au cours des 24 dernières heures qui n'ont pas encore été validées
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const pendingTransactions = await prisma.transaction.findMany({
        where: {
          transactionRef: { startsWith: 'ENKAP_' },
          status: 'PENDING',
          createdAt: { gte: cutoff },
        },
        select: {
          id: true,
          transactionRef: true,
          createdAt: true,
        },
        take: 20,
      });

      if (pendingTransactions.length === 0) {
        console.log('[Enkap Cron Job] Aucune transaction en attente de réconciliation.');
        return;
      }

      console.log(`[Enkap Cron Job] ${pendingTransactions.length} transaction(s) en attente trouvée(s). Début de la réconciliation...`);

      for (const tx of pendingTransactions) {
        if (!tx.transactionRef) continue;
        try {
          const res = await verifyAndReconcileEnkapOrder(tx.transactionRef, 'CRON_RECONCILIATION');
          console.log(`[Enkap Cron Job] Résultat pour ${tx.transactionRef}:`, sanitizeLog(res));
        } catch (err: any) {
          console.error(`[Enkap Cron Job Error] Échec pour ${tx.transactionRef}:`, err?.message || err);
        }
      }
    } catch (error: any) {
      console.error('[Enkap Cron Job Global Error]:', error?.message || error);
    }
  };

  // Exécution initiale immédiate au démarrage puis selon l'intervalle défini
  runReconciliation();
  setInterval(runReconciliation, intervalMinutes * 60 * 1000);
};
