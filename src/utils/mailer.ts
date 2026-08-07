import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

function getLogoPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'assets/nfs-logo.png'),
    path.join(process.cwd(), 'src/assets/nfs-logo.png'),
    path.join(__dirname, '../assets/nfs-logo.png'),
    path.join(__dirname, '../../assets/nfs-logo.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const sendWelcomeEmail = async (userEmail: string, userName: string, plainPassword: string) => {
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

    const logoFile = getLogoPath();

    const info = await transporter.sendMail({
      from: '"Support NFS App" <noreply@nfsapp.com>',
      to: userEmail,
      subject: 'Bienvenue sur NFS App - Vos accès',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            ${logoFile ? '<img src="cid:nfslogo" alt="NFS Logo" style="max-width: 180px; height: auto;" />' : '<h2 style="color: #0f172a; margin: 0;">NFS APP</h2>'}
          </div>
          <h2 style="color: #0f172a; margin-top: 0;">Bonjour ${userName},</h2>
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
      attachments: logoFile ? [{ filename: 'nfs-logo.png', path: logoFile, cid: 'nfslogo' }] : [],
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

    const logoFile = getLogoPath();

    const info = await transporter.sendMail({
      from: '"Support NFS App" <noreply@nfsapp.com>',
      to: userEmail,
      subject: 'NFS App - Nouveau mot de passe',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 20px;">
            ${logoFile ? '<img src="cid:nfslogo" alt="NFS Logo" style="max-width: 180px; height: auto;" />' : '<h2 style="color: #0f172a; margin: 0;">NFS APP</h2>'}
          </div>
          <h2 style="color: #0f172a; margin-top: 0;">Bonjour ${userName},</h2>
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
      attachments: logoFile ? [{ filename: 'nfs-logo.png', path: logoFile, cid: 'nfslogo' }] : [],
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

export interface TransactionInvoiceData {
  userEmail: string;
  userName: string;
  transactionRef: string;
  title: string;
  amount: number;
  currency?: string;
  date?: string;
  paymentMethod?: string;
}

function resolveReceiptSubtitle(titleStr: string): string {
  const upper = (titleStr || '').toUpperCase();
  if (upper.includes('CREDIT') || upper.includes('CRÉDIT') || upper.includes('REMBOURSEMENT')) {
    return 'DE REMBOURSEMENT DE CRÉDIT';
  }
  if (upper.includes('TONTINE') || upper.includes('COTISATION')) {
    return 'DE COTISATION TONTINE';
  }
  if (upper.includes('TRANSFERT')) {
    return 'DE TRANSFERT DE SOLDE';
  }
  if (upper.includes('WALLET') || upper.includes('PRINCIPAL')) {
    return 'D\'APPROVISIONNEMENT WALLET';
  }
  return 'D\'APPROVISIONNEMENT ÉPARGNE';
}

export const sendTransactionInvoiceEmail = async (data: TransactionInvoiceData) => {
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
      console.log('⚠️ Pas de configuration SMTP renseignée. Génération de l\'email de test Ethereal...');
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

    const dateStr = data.date || new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const formattedAmount = `${data.amount.toLocaleString('fr-FR')} ${data.currency || 'XAF'}`;
    const userNameUpper = (data.userName || 'MEMBRE NFS').toUpperCase();
    const paymentMethodUpper = (data.paymentMethod || 'ESPECE / STRIPE').toUpperCase();
    const subtitle = resolveReceiptSubtitle(data.title);
    const logoFile = getLogoPath();

    const htmlContent = `
      <div style="font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; max-width: 640px; margin: 0 auto; background-color: #f5f8fb; border-radius: 24px; overflow: hidden; border: 1px solid #e2e9f2; box-shadow: 0 20px 50px rgba(11, 61, 122, 0.15);">
        <!-- Header Logo Image -->
        <div style="background: #ffffff; padding: 28px 24px 20px 24px; text-align: center; border-bottom: 1px solid #e2e9f2;">
          ${logoFile
        ? '<img src="cid:nfslogo" alt="New Financial Services" style="max-width: 200px; width: 100%; height: auto; margin: 0 auto; display: block;" />'
        : '<div style="font-size: 28px; font-weight: 900; color: #0b3d7a;">NFS - NEW FINANCIAL SERVICES</div>'}
        </div>

        <!-- Title Block -->
        <div style="text-align: center; padding: 24px 24px 16px 24px;">
          <h1 style="font-size: 32px; font-weight: 900; color: #0b3d7a; margin: 0; letter-spacing: 1px;">REÇU</h1>
          <div style="font-size: 15px; font-weight: 800; color: #0b3d7a; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${subtitle}
          </div>
          <div style="color: #d69a1c; font-size: 20px; font-weight: bold; margin: 8px 0;">• • •</div>
          <p style="font-size: 13px; color: #3a4a5a; margin: 0; line-height: 1.6;">
            Nous vous remercions pour votre confiance.<br/>
            Ce reçu confirme la bonne réception de votre paiement.
          </p>
        </div>

        <!-- Transaction Details Table Card -->
        <div style="padding: 0 24px 24px 24px;">
          <div style="background-color: #ffffff; border: 1px solid #e2e9f2; border-radius: 18px; overflow: hidden; box-shadow: 0 6px 18px rgba(11,61,122,0.06);">
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
              <tr style="border-bottom: 1px solid #eef2f7;">
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; width: 42%; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                  📄 TRANSACTION N°
                </td>
                <td style="padding: 16px 18px; font-weight: 800; color: #1c2b3a; font-family: monospace; font-size: 14px;">
                  ${data.transactionRef}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid #eef2f7;">
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                DATE DE L'OPÉRATION
                </td>
                <td style="padding: 16px 18px; font-weight: 800; color: #1c2b3a;">
                  ${dateStr}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid #eef2f7;">
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                NOM DU MEMBRE
                </td>
                <td style="padding: 16px 18px; font-weight: 800; color: #1c2b3a; text-transform: uppercase;">
                  ${userNameUpper}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid #eef2f7;">
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                MOYEN DE PAIEMENT
                </td>
                <td style="padding: 16px 18px; font-weight: 800; color: #1c2b3a;">
                  ${paymentMethodUpper}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid #eef2f7;">
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                  MONTANT
                </td>
                <td style="padding: 16px 18px; font-weight: 900; color: #0b3d7a; font-size: 16px;">
                  ${formattedAmount}
                </td>
              </tr>
              <tr>
                <td style="padding: 16px 18px; color: #0b3d7a; font-weight: 800; text-transform: uppercase; font-size: 11.5px; letter-spacing: 0.5px;">
                  MOTIF DE L'OPÉRATION
                </td>
                <td style="padding: 16px 18px; font-weight: 800; color: #1c2b3a; text-transform: uppercase;">
                  ${data.title.toUpperCase()}
                </td>
              </tr>
            </table>
          </div>

          <!-- Notice -->
          <div style="margin-top: 18px; text-align: center; font-size: 12px; color: #3a4a5a; font-weight: 600;">
            🛡️ Ce reçu est établi électroniquement et ne nécessite pas de signature.
          </div>
        </div>

        <!-- Official Blue Footer Banner -->
        <div style="background: linear-gradient(135deg, #0b3d7a, #1a5bb8); border-top: 4px solid #d69a1c; padding: 22px 24px; text-align: center; color: #ffffff;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; color: #ffffff;">
            <tr>
              <td style="padding: 4px; text-align: center;">
                ✉️ <strong style="color: #fff;">contact.nfs23@gmail.com</strong>
              </td>
              <td style="padding: 4px; text-align: center;">
                📞 <strong>+237 695 226 269</strong>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top: 10px; text-align: center; font-size: 12px; opacity: 0.95;">
                👥 <strong>NFS, une communauté, une vision, <span style="color: #d69a1c;">un avenir.</span></strong>
              </td>
            </tr>
          </table>
        </div>
      </div>
    `;

    const info = await transporter.sendMail({
      from: '"NFS App Finance" <noreply@nfsapp.com>',
      to: data.userEmail,
      subject: `Reçu NFS App - ${subtitle} #${data.transactionRef}`,
      html: htmlContent,
      attachments: logoFile
        ? [
          {
            filename: 'nfs-logo.png',
            path: logoFile,
            cid: 'nfslogo',
          },
        ]
        : [],
    });

    console.log('[Mailer] Reçu email envoyé avec succès à %s (Message ID: %s)', data.userEmail, info.messageId);
    if (info.messageId && nodemailer.getTestMessageUrl) {
      console.log('👉 [Ethereal Mail Test Link]: %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('Erreur lors de l’envoi du reçu email:', error);
  }
};
