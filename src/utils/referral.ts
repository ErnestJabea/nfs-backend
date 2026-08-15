import prisma from '../utils/prisma';
import { dispatchNotification } from '../services/notificationDispatcher';

/**
 * Calcule et applique une commission de parrainage et notifie le parrain
 */
export const processReferralCommission = async (userId: string, amount: number, type: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true, firstName: true, lastName: true }
    });

    if (user && user.referredById) {
      await dispatchNotification({
        userId: user.referredById,
        type: 'SPONSORSHIP',
        title: 'Commission de Parrainage',
        message: `Votre filleul ${user.firstName || ''} ${user.lastName || ''}`.trim() + ` a effectué une opération de ${amount} XAF.`,
        data: { godchildId: userId, amount, transactionType: type }
      });
    }
  } catch (error) {
    console.error('Erreur lors de la notification de parrainage :', error);
  }
};
