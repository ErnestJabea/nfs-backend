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
exports.sendEpargneValidationMail = exports.sendEpargneRequestMail = exports.sendTransactionOtpEmail = exports.sendResetCode = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isSecurePort = process.env.SMTP_PORT === '465' || !process.env.SMTP_PORT;
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: isSecurePort,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
});
const sendResetCode = (email, code) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const mailOptions = {
            from: `"NFS App" <${process.env.SMTP_USER}>`,
            to: email,
            subject: 'Code de réinitialisation du mot de passe',
            text: `Votre code de réinitialisation est : ${code}. Ce code expirera dans 15 minutes.`,
            html: `<p>Votre code de réinitialisation est : <b>${code}</b></p><p>Ce code expirera dans 15 minutes.</p>`,
        };
        const info = yield transporter.sendMail(mailOptions);
        console.log(`[DEBUG] Email sent: ${info.messageId}`);
        return info;
    }
    catch (error) {
        console.error(`[ERROR] Failed to send email:`, error);
        throw error; // On relance l'erreur pour qu'elle soit captée par le contrôleur
    }
});
exports.sendResetCode = sendResetCode;
const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
const sendTransactionOtpEmail = (email, code, summary) => __awaiter(void 0, void 0, void 0, function* () {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP is not configured.');
    }
    return transporter.sendMail({
        from: `"NFS App" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Autorisation de votre transaction NFS',
        text: `Code a usage unique : ${code}. Operation : ${summary}. Il expire dans 3 minutes. Ne le communiquez a personne.`,
        html: `<p>Votre code a usage unique est : <strong>${code}</strong></p><p>Operation : ${escapeHtml(summary)}</p><p>Il expire dans 3 minutes. Ne le communiquez a personne.</p>`,
    });
});
exports.sendTransactionOtpEmail = sendTransactionOtpEmail;
const sendEpargneRequestMail = (userEmail, userFullName, montant, adminEmails) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Email pour le client
        const clientMailOptions = {
            from: `"NFS App" <${process.env.SMTP_USER}>`,
            to: userEmail,
            subject: "Demande d'épargne en attente de validation",
            text: `Bonjour ${userFullName},\n\nVotre demande d'épargne de ${montant} XAF a bien été prise en compte et est actuellement en attente de validation par le COMEX.\n\nCordialement,\nL'équipe NFS`,
            html: `<p>Bonjour <b>${userFullName}</b>,</p><p>Votre demande d'épargne de <b>${montant} XAF</b> a bien été prise en compte et est actuellement en attente de validation par le COMEX.</p><p>Cordialement,<br>L'équipe NFS</p>`,
        };
        yield transporter.sendMail(clientMailOptions);
        // Email pour les administrateurs (COMEX)
        if (adminEmails.length > 0) {
            const adminMailOptions = {
                from: `"NFS App" <${process.env.SMTP_USER}>`,
                to: adminEmails.join(','),
                subject: "Nouvelle demande d'épargne à valider",
                text: `Une nouvelle demande d'épargne de ${montant} XAF a été effectuée par ${userFullName} (${userEmail}).\nVeuillez vous connecter au backoffice pour la valider.`,
                html: `<p>Une nouvelle demande d'épargne de <b>${montant} XAF</b> a été effectuée par <b>${userFullName}</b> (${userEmail}).</p><p>Veuillez vous connecter au backoffice pour la valider.</p>`,
            };
            yield transporter.sendMail(adminMailOptions);
        }
    }
    catch (error) {
        console.error(`[ERROR] Failed to send epargne request email:`, error);
    }
});
exports.sendEpargneRequestMail = sendEpargneRequestMail;
const sendEpargneValidationMail = (userEmail, userFullName, montant) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const mailOptions = {
            from: `"NFS App" <${process.env.SMTP_USER}>`,
            to: userEmail,
            subject: "Validation de votre épargne",
            text: `Bonjour ${userFullName},\n\nBonne nouvelle ! Votre demande d'épargne de ${montant} XAF a été validée avec succès par le COMEX.\nLe montant a été ajouté à votre solde.\n\nCordialement,\nL'équipe NFS`,
            html: `<p>Bonjour <b>${userFullName}</b>,</p><p>Bonne nouvelle ! Votre demande d'épargne de <b>${montant} XAF</b> a été validée avec succès par le COMEX.</p><p>Le montant a été ajouté à votre solde.</p><p>Cordialement,<br>L'équipe NFS</p>`,
        };
        yield transporter.sendMail(mailOptions);
    }
    catch (error) {
        console.error(`[ERROR] Failed to send epargne validation email:`, error);
    }
});
exports.sendEpargneValidationMail = sendEpargneValidationMail;
