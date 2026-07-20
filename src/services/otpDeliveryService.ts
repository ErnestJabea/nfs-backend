import axios from 'axios';
import { sendTransactionOtpEmail } from './mailService';

type OtpRecipient = {
  phone: string;
  email?: string | null;
};

export type OtpDeliveryResult = {
  channel: 'sms' | 'email' | 'development';
  destination: string;
  developmentOtp?: string;
};

export type SecurityOtpDeliveryMode = 'sms' | 'development';

export const getSecurityOtpDeliveryMode = (): SecurityOtpDeliveryMode | null => {
  if (process.env.OTP_SMS_WEBHOOK_URL) return 'sms';
  if (process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_EXPOSE_CODE === 'true') return 'development';
  return null;
};

export const assertSecurityOtpDeliveryConfigured = (): SecurityOtpDeliveryMode => {
  const mode = getSecurityOtpDeliveryMode();
  if (mode) return mode;

  const error: any = new Error('Le canal SMS de sécurité n’est pas configuré.');
  error.status = 503;
  error.code = 'SECURITY_OTP_DELIVERY_UNAVAILABLE';
  throw error;
};

const deliverSms = async (recipient: OtpRecipient, code: string, message: string, purpose: string) => {
  const smsWebhook = process.env.OTP_SMS_WEBHOOK_URL;
  if (!smsWebhook) return null;

  await axios.post(
    smsWebhook,
    { to: recipient.phone, message, purpose },
    {
      headers: process.env.OTP_SMS_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.OTP_SMS_WEBHOOK_TOKEN}` }
        : undefined,
      timeout: 10_000,
      maxRedirects: 0,
    },
  );
  return { channel: 'sms' as const, destination: maskPhone(recipient.phone) };
};

const maskPhone = (phone: string) => phone.length <= 4
  ? '****'
  : `${phone.slice(0, 2)}${'*'.repeat(Math.max(4, phone.length - 4))}${phone.slice(-2)}`;

const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
};

export const deliverTransactionOtp = async (
  recipient: OtpRecipient,
  code: string,
  summary: string,
): Promise<OtpDeliveryResult> => {
  const smsDelivery = await deliverSms(
    recipient,
    code,
    `NFS: code ${code}. ${summary}. Expire dans 3 minutes. Ne le partagez jamais.`,
    'transaction_authorization',
  );
  if (smsDelivery) return smsDelivery;

  if (recipient.email && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    await sendTransactionOtpEmail(recipient.email, code, summary);
    return { channel: 'email', destination: maskEmail(recipient.email) };
  }

  if (process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_EXPOSE_CODE === 'true') {
    return { channel: 'development', destination: 'development', developmentOtp: code };
  }

  const error: any = new Error('Aucun canal OTP transactionnel n’est configure.');
  error.status = 503;
  error.code = 'OTP_DELIVERY_UNAVAILABLE';
  throw error;
};

export const deliverSecurityOtp = async (
  recipient: OtpRecipient,
  code: string,
): Promise<OtpDeliveryResult> => {
  assertSecurityOtpDeliveryConfigured();
  const smsDelivery = await deliverSms(
    recipient,
    code,
    `NFS: code de confirmation MFA ${code}. Il expire dans 5 minutes. Ne le partagez jamais.`,
    'mfa_enrollment',
  );
  if (smsDelivery) return smsDelivery;

  if (process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_EXPOSE_CODE === 'true') {
    return { channel: 'development', destination: 'development', developmentOtp: code };
  }

  // La configuration est validée au début de la fonction.
  throw new Error('Canal OTP de sécurité indisponible.');
};
