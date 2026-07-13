import nodemailer from 'nodemailer';

export const sendWelcomeEmail = async (userEmail: string, userName: string, plainPassword: string) => {
  try {
    // Si pas de config SMTP, on utilise un compte de test Ethereal généré à la volée
    let transporter;
    
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      console.log('⚠️ Pas de configuration SMTP trouvée, utilisation d\'Ethereal pour les tests...');
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    const info = await transporter.sendMail({
      from: '"Support NFS App" <noreply@nfsapp.com>',
      to: userEmail,
      subject: 'Bienvenue sur NFS App - Vos accès',
      html: `
        <div style="font-family: Arial, sans-serif; max-w-md mx-auto; p-6; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f172a;">Bonjour ${userName},</h2>
          <p>Votre compte NFS App a été créé avec succès par un administrateur.</p>
          <p>Voici vos identifiants pour vous connecter à l'application mobile :</p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Mot de passe temporaire :</strong> <span style="font-size: 18px; color: #2563eb; font-weight: bold; font-family: monospace;">${plainPassword}</span></p>
          </div>
          <p style="color: #64748b; font-size: 12px;">Nous vous recommandons de modifier ce mot de passe dès votre première connexion.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #64748b; font-size: 12px;">L'équipe NFS App</p>
        </div>
      `,
    });

    console.log('Email envoyé : %s', info.messageId);
    if (info.messageId && nodemailer.getTestMessageUrl) {
      console.log('👉 Voir l\'email généré : %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error);
  }
};

export const sendPasswordResetEmail = async (userEmail: string, userName: string, plainPassword: string) => {
  try {
    let transporter;

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      console.log('Pas de configuration SMTP trouvee, utilisation d Ethereal pour les tests...');
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    const info = await transporter.sendMail({
      from: '"Support NFS App" <noreply@nfsapp.com>',
      to: userEmail,
      subject: 'NFS App - Nouveau mot de passe',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f172a;">Bonjour ${userName},</h2>
          <p>Votre mot de passe administrateur NFS App a ete reinitialise.</p>
          <p>Voici votre nouveau mot de passe temporaire :</p>
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Mot de passe temporaire :</strong> <span style="font-size: 18px; color: #2563eb; font-weight: bold; font-family: monospace;">${plainPassword}</span></p>
          </div>
          <p style="color: #64748b; font-size: 12px;">Modifiez ce mot de passe apres votre prochaine connexion.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #64748b; font-size: 12px;">L'equipe NFS App</p>
        </div>
      `,
    });

    console.log('Email de reinitialisation envoye : %s', info.messageId);
    if (info.messageId && nodemailer.getTestMessageUrl) {
      console.log('Voir l email genere : %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Erreur lors de l envoi de l email de reinitialisation:', error);
    throw error;
  }
};
