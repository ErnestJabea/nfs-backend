import { Request, Response } from 'express';
import { createEnkapOrder, getEnkapOrderStatus, verifyAndReconcileEnkapOrder, sanitizeLog } from '../services/enkapService';

/**
 * Initialisation d'un paiement Enkap
 */
export const initiateEnkapPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id || req.body.userId;
    const { amount, type, targetAccountType, groupId, phoneNumber, customerName, userEmail, returnUrl } = req.body;

    if (!userId || !amount || !type) {
      res.status(400).json({ error: 'Champs obligatoires manquants: userId, amount, type.' });
      return;
    }

    const orderResult = await createEnkapOrder({
      userId,
      amount: Number(amount),
      type,
      targetAccountType,
      groupId,
      phoneNumber,
      customerName,
      userEmail,
      returnUrl,
    });

    res.status(200).json({
      success: true,
      message: 'Commande Enkap générée avec succès.',
      data: orderResult,
    });
  } catch (error: any) {
    console.error('[Enkap Controller] Erreur d\'initiation:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Erreur interne d\'initiation de paiement Enkap.' });
  }
};

/**
 * Webhook ITN e-nkap (PUT /api/payments/enkap/notification/:merchantReference)
 * Zero-Trust : Réponse HTTP 200 immédiate + Déclenchement asynchrone de la réconciliation
 */
export const handleEnkapWebhookNotification = async (req: Request, res: Response): Promise<void> => {
  const merchantReference = String(req.params.merchantReference || req.query.orderMerchantId || req.body?.merchantReference || '').trim();

  console.log('[Enkap Webhook] Signal ITN reçu:', sanitizeLog({ merchantReference, params: req.params, query: req.query }));

  // 1. Reponse instantanée à l'agrégateur (Accusé de réception 200 OK)
  res.status(200).json({ status: 'ACKNOWLEDGED', message: 'Signal ITN e-nkap bien reçu.' });

  if (!merchantReference) {
    console.warn('[Enkap Webhook] Référence marchand manquante dans le signal ITN.');
    return;
  }

  // 2. Traitement asynchrone Zero-Trust
  setImmediate(async () => {
    try {
      await verifyAndReconcileEnkapOrder(merchantReference, 'WEBHOOK_TRIGGER');
    } catch (err: any) {
      console.error('[Enkap Webhook Error] Échec de la réconciliation asynchrone:', err?.message || err);
    }
  });
};

/**
 * Inscription / Polling de statut pour le Front-end
 */
export const getEnkapStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const merchantReference = String(req.params.merchantReference || req.query.orderMerchantId || '').trim();

    if (!merchantReference) {
      res.status(400).json({ error: 'Référence marchand requise.' });
      return;
    }

    // Réconciliation à la volée si demandé
    const reconciliation = await verifyAndReconcileEnkapOrder(merchantReference, 'MANUAL_AUDIT');
    const rawStatus = await getEnkapOrderStatus(merchantReference);

    res.status(200).json({
      success: true,
      data: {
        merchantReference,
        status: reconciliation.status,
        reconciled: reconciliation.reconciled,
        rawStatus: sanitizeLog(rawStatus),
      },
    });
  } catch (error: any) {
    console.error('[Enkap Controller] Erreur de vérification statut:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Erreur lors de la vérification du statut.' });
  }
};

