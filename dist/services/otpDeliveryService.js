"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliverTransactionOtp = void 0;
const axios_1 = __importDefault(require("axios"));
const mailService_1 = require("./mailService");
const maskPhone = (phone) => phone.length <= 4
    ? '****'
    : `${phone.slice(0, 2)}${'*'.repeat(Math.max(4, phone.length - 4))}${phone.slice(-2)}`;
const maskEmail = (email) => {
    const [local, domain] = email.split('@');
    if (!domain)
        return '***';
    return `${local.slice(0, 1)}***@${domain}`;
};
const deliverTransactionOtp = (recipient, code, summary) => __awaiter(void 0, void 0, void 0, function* () {
    const smsWebhook = process.env.OTP_SMS_WEBHOOK_URL;
    if (smsWebhook) {
        yield axios_1.default.post(smsWebhook, {
            to: recipient.phone,
            message: `NFS: code ${code}. ${summary}. Expire dans 3 minutes. Ne le partagez jamais.`,
            purpose: 'transaction_authorization',
        }, {
            headers: process.env.OTP_SMS_WEBHOOK_TOKEN
                ? { Authorization: `Bearer ${process.env.OTP_SMS_WEBHOOK_TOKEN}` }
                : undefined,
            timeout: 10000,
            maxRedirects: 0,
        });
        return { channel: 'sms', destination: maskPhone(recipient.phone) };
    }
    if (recipient.email && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            yield (0, mailService_1.sendTransactionOtpEmail)(recipient.email, code, summary);
            return { channel: 'email', destination: maskEmail(recipient.email) };
        }
        catch (error) {
            console.error('[OTP Delivery] Echec de l’envoi d’email OTP:', error);
            if (process.env.NODE_ENV !== 'production' || process.env.OTP_DEV_EXPOSE_CODE === 'true') {
                return { channel: 'development', destination: 'development', developmentOtp: code };
            }
            throw error;
        }
    }
    if (process.env.NODE_ENV !== 'production' && process.env.OTP_DEV_EXPOSE_CODE === 'true') {
        return { channel: 'development', destination: 'development', developmentOtp: code };
    }
    const error = new Error('Aucun canal OTP transactionnel n’est configure.');
    error.status = 503;
    error.code = 'OTP_DELIVERY_UNAVAILABLE';
    throw error;
});
exports.deliverTransactionOtp = deliverTransactionOtp;
