import axios from 'axios';
import prisma from '../utils/prisma';

const getEnkapConfig = () => {
  const clientId = process.env.ENKAP_CLIENT_ID || 'lEgtVnDQtJdlSuU1jL9BGabrQIka';
  const clientSecret = process.env.ENKAP_CLIENT_SECRET || '16qfsf41TakQ8fglW14QqLpikwka';
  const baseUrl = process.env.ENKAP_BASE_URL || 'https://api.enkap-staging.maviance.info';
  const evisaUrl = process.env.ENKAP_EVISA_URL || 'https://api-evisa.enkap-staging.maviance.info';

  return { clientId, clientSecret, baseUrl, evisaUrl };
};

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Sanitisation des logs RGPD/PCI-DSS
 */
export const sanitizeLog = (data: any): any => {
  if (!data) return data;
  try {
    const copy = JSON.parse(JSON.stringify(data));
    if (copy.phoneNumber) copy.phoneNumber = copy.phoneNumber.replace(/^(\d{4})\d+(\d{2})$/, '$1****$2');
    if (copy.email) copy.email = copy.email.replace(/^(.)(.*)(@.*)$/, '$1***$3');
    if (copy.access_token) copy.access_token = '***MASKED***';
    return copy;
  } catch {
    return '[Unserializable Data]';
  }
};

/**
 * Génération / Récupération du jeton OAuth Enkap (Maviance Sandbox Kori)
 */
export const getEnkapToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const { clientId, clientSecret, baseUrl } = getEnkapConfig();
  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  try {
    const response = await axios.post(
      `${baseUrl}/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    let token = '';
    let expiresIn = 3600;

    if (typeof response.data === 'string') {
      token = response.data.trim();
    } else if (response.data?.access_token) {
      token = response.data.access_token;
      if (response.data.expires_in) {
        expiresIn = Number(response.data.expires_in);
      }
    } else {
      throw new Error('Réponse de token Enkap invalide.');
    }

    cachedToken = token;
    tokenExpiresAt = now + expiresIn * 1000;
    return token;
  } catch (error: any) {
    console.error('[Enkap Auth Error]:', sanitizeLog(error?.response?.data || error?.message || error));
    throw new Error(`Impossible d'obtenir un jeton d'accès Enkap: ${error?.response?.data?.error_description || error?.message}`);
  }
};

export interface CreateEnkapOrderOptions {
  userId: string;
  customerName?: string;
  userEmail?: string;
  phoneNumber?: string;
  type: 'ACCOUNT_FUNDING' | 'COTISATION_PAYMENT';
  targetAccountType?: 'PRINCIPAL' | 'EPARGNE';
  groupId?: string;
  amount: number;
  currency?: string;
  returnUrl?: string;
  notificationUrl?: string;
}

/**
 * Création d'une commande d'approvisionnement / paiement via l'API Enkap
 */
export const createEnkapOrder = async (options: CreateEnkapOrderOptions) => {
  const token = await getEnkapToken();
  const { baseUrl } = getEnkapConfig();

  const amount = Math.abs(Number(options.amount || 0));
  if (amount <= 0) {
    throw new Error('Le montant de la transaction doit être supérieur à 0.');
  }

  const merchantReference = `ENKAP_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const uuid = `e09z${Date.now()}${Math.random().toString(36).substring(2, 10)}`;

  let title = 'Approvisionnement Wallet NFS';
  let description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Wallet NFS`;

  if (options.type === 'ACCOUNT_FUNDING' && options.targetAccountType === 'EPARGNE') {
    title = 'Approvisionnement Solde Épargne';
    description = `Crédit de ${amount.toLocaleString('fr-FR')} XAF sur votre Compte Épargne`;
  } else if (options.type === 'COTISATION_PAYMENT') {
    title = 'Cotisation Tontine NFS';
    description = `Paiement de cotisation de ${amount.toLocaleString('fr-FR')} XAF`;
    if (options.groupId) {
      const group = await prisma.cotisationGroup.findUnique({ where: { id: options.groupId }, select: { name: true } });
      if (group?.name) description = `Cotisation au groupe ${group.name}`;
    }
  }

  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const rawReturnUrl = options.returnUrl || 'https://app.nfs.ejabbing.com/funding';
  const finalReturnUrl = rawReturnUrl
    .replace('{ORDER_REF}', merchantReference)
    .replace('{CHECKOUT_SESSION_ID}', merchantReference)
    .replace('{ORDER_ID}', merchantReference);

  const payload = {
    currency: options.currency || 'XAF',
    customerName: options.customerName || 'Membre NFS',
    description: description,
    email: options.userEmail || 'member@nfs.cm',
    expiryDate: expiry.toISOString(),
    id: {
      uuid: uuid,
      version: 'V1.2',
    },
    items: [
      {
        itemId: options.type === 'COTISATION_PAYMENT' ? 'TONTINE_COTISATION' : 'WALLET_RECHARGE',
        particulars: title,
        quantity: 1,
        subTotal: amount,
        unitCost: amount,
      },
    ],
    langKey: 'fr',
    merchantReference: merchantReference,
    optRefOne: options.userId,
    optRefTwo: `${options.type}:${options.targetAccountType || 'PRINCIPAL'}:${options.groupId || ''}`,
    orderDate: now.toISOString(),
    phoneNumber: options.phoneNumber ? options.phoneNumber.replace(/^\+/, '') : '237600000000',
    receiptUrl: finalReturnUrl,
    totalAmount: amount,
    returnUrl: finalReturnUrl,
    notificationUrl: options.notificationUrl || 'https://api-nfs.ejabbing.com/api/payments/enkap/notification',
  };

  try {
    console.log('[Enkap Create Order] Sending payload:', sanitizeLog(payload));
    const response = await axios.post(
      `${baseUrl}/purchase/v1.2/api/order`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return {
      orderMerchantId: merchantReference,
      reference: merchantReference,
      amount,
      currency: options.currency || 'XAF',
      rawResponse: response.data,
      paymentUrl: response.data?.payUrl || response.data?.redirectUrl || null,
      status: response.data?.status || 'PENDING',
    };
  } catch (error: any) {
    console.error('[Enkap Create Order Error]:', sanitizeLog(error?.response?.data || error?.message || error));
    throw new Error(`Erreur lors de la création de la commande Enkap: ${JSON.stringify(error?.response?.data || error?.message)}`);
  }
};

/**
 * Récupération du statut de la commande Enkap via orderMerchantId (Vérification Serveur-à-Serveur)
 */
export const getEnkapOrderStatus = async (orderMerchantId: string) => {
  const token = await getEnkapToken();
  const { evisaUrl } = getEnkapConfig();

  try {
    const response = await axios.get(
      `${evisaUrl}/purchase/v1.2/api/order/status`,
      {
        params: { orderMerchantId },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 15000,
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[Enkap Status Check Error]:', sanitizeLog(error?.response?.data || error?.message || error));
    return null;
  }
};

/**
 * Récupération des détails de la commande Enkap via txid
 */
export const getEnkapOrderDetails = async (txid: string) => {
  const token = await getEnkapToken();
  const { evisaUrl } = getEnkapConfig();

  try {
    const response = await axios.get(
      `${evisaUrl}/purchase/v1.2/api/order`,
      {
        params: { txid },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 15000,
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('[Enkap Order Details Error]:', sanitizeLog(error?.response?.data || error?.message || error));
    return null;
  }
};

/**
 * Traitement Idempotent du succès d'une transaction Enkap
 */
export const processEnkapOrderCompleted = async (data: {
  orderMerchantId: string;
  txid?: string;
  userId: string;
  type: 'ACCOUNT_FUNDING' | 'COTISATION_PAYMENT';
  targetAccountType?: 'PRINCIPAL' | 'EPARGNE';
  groupId?: string;
  amount: number;
}) => {
  const { orderMerchantId, txid, userId, type, targetAccountType = 'PRINCIPAL', groupId, amount } = data;

  if (!userId || !type || amount <= 0) {
    throw new Error('Données de transaction Enkap incomplètes ou montant invalide.');
  }

  const transactionRef = orderMerchantId.startsWith('ENKAP_') ? orderMerchantId : `ENKAP_${orderMerchantId}`;

  const existingTransaction = await prisma.transaction.findFirst({
    where: { transactionRef },
    select: { id: true },
  });

  if (existingTransaction) {
    console.log(`[Enkap Webhook] Transaction déjà traitée (idempotence): ${transactionRef}`);
    return { processed: true, idempotency: true, transactionRef };
  }

  if (type === 'ACCOUNT_FUNDING') {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { accountIds: true } });
      if (!user) throw new Error(`Utilisateur ${userId} introuvable pour le crédit Enkap.`);

      let account = await tx.account.findFirst({
        where: { id: { in: user.accountIds || [] }, type: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL' },
      });

      if (!account) {
        console.log(`[Enkap Webhook] Création du compte ${targetAccountType} pour l'utilisateur ${userId}...`);
        account = await tx.account.create({
          data: {
            type: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
            currency: 'XAF',
            currentBalance: 0,
            availableBalance: 0,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { accountIds: { push: account.id } },
        });
      }

      await tx.account.update({
        where: { id: account.id },
        data: {
          currentBalance: { increment: amount },
          availableBalance: { increment: amount },
        },
      });

      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
        update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
      });

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          purpose: `Approvisionner ${targetAccountType === 'EPARGNE' ? 'Solde Épargne' : 'Wallet NFS'} via Enkap`,
          amount,
          status: 'SUCCESS',
          transactionRef,
          targetAccountType: targetAccountType === 'EPARGNE' ? 'EPARGNE' : 'PRINCIPAL',
          currency: 'XAF',
          createdBy: 'EnkapWebhook',
          operation: { type: 'account_funding_enkap', orderMerchantId, txid, amount },
        },
      });

      console.log(`[Enkap Webhook] Compte ${targetAccountType} de l'utilisateur ${userId} crédité de ${amount} XAF via Enkap.`);
      return { processed: true, transactionId: createdTx.id, transactionRef };
    });
  } else if (type === 'COTISATION_PAYMENT') {
    if (!groupId) throw new Error('ID du groupe de cotisation manquant.');

    return await prisma.$transaction(async (tx) => {
      const group = await tx.cotisationGroup.findUnique({ where: { id: groupId } });
      if (!group) throw new Error(`Groupe de cotisation ${groupId} introuvable.`);

      const periodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

      await tx.cotisationPayment.create({
        data: {
          userId,
          groupId,
          periodKey,
          amount,
          transactionRef,
        },
      });

      await tx.systemBalance.upsert({
        where: { code: 'NFS_GLOBAL' },
        create: { code: 'NFS_GLOBAL', totalSavings: amount, availableLiquidity: amount },
        update: { totalSavings: { increment: amount }, availableLiquidity: { increment: amount }, lastUpdated: new Date() },
      });

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          purpose: `Cotisation Tontine - ${group.name}`,
          amount,
          status: 'SUCCESS',
          transactionRef,
          targetAccountType: 'PRINCIPAL',
          currency: 'XAF',
          createdBy: 'EnkapWebhook',
          operation: { type: 'cotisation_payment_enkap', groupId, orderMerchantId, txid, amount },
        },
      });

      console.log(`[Enkap Webhook] Cotisation de ${amount} XAF enregistrée pour l'utilisateur ${userId} dans le groupe ${groupId}.`);
      return { processed: true, transactionId: createdTx.id, transactionRef };
    });
  }

  throw new Error(`Type de transaction non pris en charge: ${type}`);
};

/**
 * ARCHITECTURE ZERO-TRUST : Vérification et Réconciliation de la Commande
 * Effectue un appel GET serveur-à-serveur officiel pour réconcilier la transaction en BDD.
 */
export const verifyAndReconcileEnkapOrder = async (orderMerchantId: string, source: 'WEBHOOK_TRIGGER' | 'CRON_RECONCILIATION' | 'MANUAL_AUDIT') => {
  console.log(`[Zero-Trust Verification] Verification de la transaction ${orderMerchantId} (Source: ${source})...`);
  
  const statusData = await getEnkapOrderStatus(orderMerchantId);
  
  if (!statusData) {
    console.warn(`[Zero-Trust Verification] Aucun statut retourne par Enkap pour: ${orderMerchantId}`);
    return { reconciled: false, status: 'UNKNOWN' };
  }

  console.log(`[Zero-Trust Verification] Statut Enkap officiel pour ${orderMerchantId}:`, sanitizeLog(statusData));

  const status = statusData.status || statusData.orderStatus || 'PENDING';
  
  if (status === 'SUCCESS' || status === 'CONFIRMED' || status === 'SUCCESSFUL') {
    // Extraire les métadonnées depuis optRefOne et optRefTwo si présentes
    const userId = statusData.optRefOne || statusData.merchantReferenceData?.optRefOne;
    const optRefTwo = statusData.optRefTwo || statusData.merchantReferenceData?.optRefTwo || 'ACCOUNT_FUNDING:PRINCIPAL:';
    
    const parts = optRefTwo.split(':');
    const type = (parts[0] || 'ACCOUNT_FUNDING') as 'ACCOUNT_FUNDING' | 'COTISATION_PAYMENT';
    const targetAccountType = (parts[1] || 'PRINCIPAL') as 'PRINCIPAL' | 'EPARGNE';
    const groupId = parts[2] || undefined;
    const amount = Number(statusData.totalAmount || statusData.amount || 0);

    if (userId && amount > 0) {
      const result = await processEnkapOrderCompleted({
        orderMerchantId,
        txid: statusData.txid || statusData.id?.uuid,
        userId,
        type,
        targetAccountType,
        groupId,
        amount,
      });

      return { reconciled: true, status: 'CONFIRMED', result };
    }
  }

  return { reconciled: false, status };
};
