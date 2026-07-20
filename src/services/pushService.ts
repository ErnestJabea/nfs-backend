import crypto from 'crypto';
import webpush from 'web-push';
import { getJwtSecret, isProduction } from '../config/security';

type VapidConfig = { publicKey: string; privateKey: string; subject: string };
let configuredSignature = '';

const developmentVapidKeys = () => {
  const privateKeyBytes = crypto.createHash('sha256').update(`nfs-dev-vapid:${getJwtSecret()}`).digest();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateKeyBytes);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: privateKeyBytes.toString('base64url'),
  };
};

export const getVapidConfig = (): VapidConfig | null => {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || 'mailto:security@nfs.finance').trim();
  if (publicKey && privateKey) return { publicKey, privateKey, subject };
  if (isProduction) return null;
  return { ...developmentVapidKeys(), subject };
};

const configure = () => {
  const config = getVapidConfig();
  if (!config) return null;
  const signature = `${config.subject}:${config.publicKey}`;
  if (signature !== configuredSignature) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configuredSignature = signature;
  }
  return config;
};

export const getPushPublicKey = () => configure()?.publicKey || null;

export const sendPush = async (subscription: { endpoint: string; p256dh: string; auth: string }, payload: Record<string, unknown>) => {
  if (!configure()) {
    const error: any = new Error('Web Push is not configured.');
    error.code = 'PUSH_NOT_CONFIGURED';
    throw error;
  }
  return webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  }, JSON.stringify(payload), { TTL: 300, urgency: 'high' });
};
