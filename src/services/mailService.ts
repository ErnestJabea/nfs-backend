import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // Forcé à true pour le port 465 (Gmail)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000, // 10 secondes max pour se connecter
});

export const sendResetCode = async (email: string, code: string) => {
  try {
    const mailOptions = {
      from: `"NFS App" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Code de réinitialisation du mot de passe',
      text: `Votre code de réinitialisation est : ${code}. Ce code expirera dans 15 minutes.`,
      html: `<p>Votre code de réinitialisation est : <b>${code}</b></p><p>Ce code expirera dans 15 minutes.</p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[DEBUG] Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`[ERROR] Failed to send email:`, error);
    throw error; // On relance l'erreur pour qu'elle soit captée par le contrôleur
  }
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export const sendTransactionOtpEmail = async (email: string, code: string, summary: string) => {
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
};

export const isSmtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export const sendNotificationEmail = async (input: {
  to: string;
  subject: string;
  recipientName: string;
  title: string;
  body: string;
  receiptNumber?: string;
  receiptPdf?: Buffer;
}) => {
  if (!isSmtpConfigured()) throw new Error('SMTP is not configured.');
  const greeting = input.recipientName ? `Bonjour ${input.recipientName},` : 'Bonjour,';
  const receiptText = input.receiptNumber ? ` Recu electronique : ${input.receiptNumber}.` : '';
  return transporter.sendMail({
    from: `"New Financial Services" <${process.env.SMTP_USER}>`,
    to: input.to,
    subject: input.subject,
    text: `${greeting}\n\n${input.title}\n${input.body}.${receiptText}\n\nCordialement,\nNew Financial Services`,
    html: `
      <div style="background:#f3f6fb;padding:24px;font-family:Arial,sans-serif;color:#151940">
        <div style="max-width:620px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #dbe7f2">
          <div style="background:#0f5da8;padding:22px 28px;color:#fff">
            <div style="font-size:28px;font-weight:800;letter-spacing:2px">NFS</div>
            <div style="font-size:11px;opacity:.9">NEW FINANCIAL SERVICES</div>
          </div>
          <div style="padding:28px">
            <p>${escapeHtml(greeting)}</p>
            <h1 style="font-size:20px;color:#0f5da8;margin:20px 0 10px">${escapeHtml(input.title)}</h1>
            <p style="line-height:1.65;color:#52647a">${escapeHtml(input.body)}</p>
            ${input.receiptNumber ? `<div style="margin-top:20px;padding:14px;border-radius:12px;background:#eef6ff;color:#0f5da8;font-weight:700">Recu electronique : ${escapeHtml(input.receiptNumber)}</div>` : ''}
            <p style="margin-top:26px;font-size:12px;color:#7f8192">Ce message concerne une operation sur votre compte NFS. Ne communiquez jamais vos codes OTP.</p>
          </div>
        </div>
      </div>`,
    attachments: input.receiptPdf && input.receiptNumber ? [{
      filename: `${input.receiptNumber}.pdf`,
      content: input.receiptPdf,
      contentType: 'application/pdf',
    }] : undefined,
  });
};

export const sendEpargneRequestMail = async (userEmail: string, userFullName: string, montant: number, adminEmails: string[]) => {
  try {
    // Email pour le client
    const clientMailOptions = {
      from: `"NFS App" <${process.env.SMTP_USER}>`,
      to: userEmail,
      subject: "Demande d'épargne en attente de validation",
      text: `Bonjour ${userFullName},\n\nVotre demande d'épargne de ${montant} XAF a bien été prise en compte et est actuellement en attente de validation par le COMEX.\n\nCordialement,\nL'équipe NFS`,
      html: `<p>Bonjour <b>${userFullName}</b>,</p><p>Votre demande d'épargne de <b>${montant} XAF</b> a bien été prise en compte et est actuellement en attente de validation par le COMEX.</p><p>Cordialement,<br>L'équipe NFS</p>`,
    };
    await transporter.sendMail(clientMailOptions);

    // Email pour les administrateurs (COMEX)
    if (adminEmails.length > 0) {
      const adminMailOptions = {
        from: `"NFS App" <${process.env.SMTP_USER}>`,
        to: adminEmails.join(','),
        subject: "Nouvelle demande d'épargne à valider",
        text: `Une nouvelle demande d'épargne de ${montant} XAF a été effectuée par ${userFullName} (${userEmail}).\nVeuillez vous connecter au backoffice pour la valider.`,
        html: `<p>Une nouvelle demande d'épargne de <b>${montant} XAF</b> a été effectuée par <b>${userFullName}</b> (${userEmail}).</p><p>Veuillez vous connecter au backoffice pour la valider.</p>`,
      };
      await transporter.sendMail(adminMailOptions);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to send epargne request email:`, error);
  }
};

export const sendEpargneValidationMail = async (userEmail: string, userFullName: string, montant: number) => {
  try {
    const mailOptions = {
      from: `"NFS App" <${process.env.SMTP_USER}>`,
      to: userEmail,
      subject: "Validation de votre épargne",
      text: `Bonjour ${userFullName},\n\nBonne nouvelle ! Votre demande d'épargne de ${montant} XAF a été validée avec succès par le COMEX.\nLe montant a été ajouté à votre solde.\n\nCordialement,\nL'équipe NFS`,
      html: `<p>Bonjour <b>${userFullName}</b>,</p><p>Bonne nouvelle ! Votre demande d'épargne de <b>${montant} XAF</b> a été validée avec succès par le COMEX.</p><p>Le montant a été ajouté à votre solde.</p><p>Cordialement,<br>L'équipe NFS</p>`,
    };
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`[ERROR] Failed to send epargne validation email:`, error);
  }
};
