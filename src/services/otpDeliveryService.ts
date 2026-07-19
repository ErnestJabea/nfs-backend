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
  const smsWebhook = process.env.OTP_SMS_WEBHOOK_URL;
  if (smsWebhook) {
    await axios.post(
      smsWebhook,
      {
        to: recipient.phone,
        message: `NFS: code ${code}. ${summary}. Expire dans 3 minutes. Ne le partagez jamais.`,
        purpose: 'transaction_authorization',
      },
      {
        headers: process.env.OTP_SMS_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.OTP_SMS_WEBHOOK_TOKEN}` }
          : undefined,
        timeout: 10_000,
        maxRedirects: 0,
      },
    );
    return { channel: 'sms', destination: maskPhone(recipient.phone) };
  }

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
