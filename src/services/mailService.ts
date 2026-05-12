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

