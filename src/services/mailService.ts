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
