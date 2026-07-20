import crypto from 'crypto';
import path from 'path';
import PDFDocument from 'pdfkit';

const BLUE = '#0F5DA8';
const NAVY = '#151940';
const GOLD = '#E6B43C';
const PALE_BLUE = '#EAF4FF';
const BORDER = '#D7E5F2';
const MUTED = '#52647A';
const LOGO_PATH = path.resolve(__dirname, '../assets/nfs-logo.png');

export const receiptNumberForEvent = (eventId: string, createdAt = new Date()) => {
  const date = createdAt.toISOString().slice(0, 10).replace(/-/g, '');
  const digest = crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 10).toUpperCase();
  return `NFS-${date}-${digest}`;
};

export const verificationCodeForEvent = (eventId: string, userId: string) => crypto
  .createHash('sha256')
  .update(`receipt:${eventId}:${userId}`)
  .digest('hex')
  .slice(0, 20)
  .toUpperCase();

const money = (value: unknown, currency = 'XAF') => {
  const amount = Math.abs(Number(value || 0)).toLocaleString('fr-FR').replace(/[\u00A0\u202F]/g, ' ');
  return `${amount} ${currency}`;
};

const formatDate = (value: unknown, timezone = 'Africa/Douala') => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: timezone,
  }).format(date);
};

const safeText = (value: unknown, fallback = '-') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const titleLines = (title: string) => {
  const normalized = safeText(title, 'REÇU DE TRANSACTION').toUpperCase();
  if (normalized.startsWith('RECU ')) return ['REÇU', normalized.slice(5)];
  if (normalized.startsWith('REÇU ')) return ['REÇU', normalized.slice(5)];
  return ['REÇU', normalized];
};

const drawBrand = (doc: PDFKit.PDFDocument) => {
  doc.save();
  doc.fillColor('#70B9EF').path('M 0 0 L 205 0 C 150 38 102 72 0 115 Z').fill();
  doc.fillColor('#B8DDF6').path('M 0 0 L 145 0 C 108 28 70 51 0 78 Z').fill();
  doc.image(LOGO_PATH, 222.5, 8, { fit: [150, 120], align: 'center', valign: 'center' });
  doc.restore();
};

const drawFooter = (doc: PDFKit.PDFDocument) => {
  const pageHeight = doc.page.height;
  doc.save();
  doc.fillColor('#5DB2EB').path(`M 0 ${pageHeight - 78} C 190 ${pageHeight - 105} 360 ${pageHeight - 50} 595 ${pageHeight - 90} L 595 ${pageHeight} L 0 ${pageHeight} Z`).fill();
  doc.strokeColor(GOLD).lineWidth(3).path(`M 0 ${pageHeight - 78} C 190 ${pageHeight - 105} 360 ${pageHeight - 50} 595 ${pageHeight - 90}`).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
  doc.text(process.env.NFS_CONTACT_EMAIL || 'contact@nfs.finance', 35, pageHeight - 45, { width: 170 });
  doc.text(process.env.NFS_CONTACT_PHONE || '+237 000 000 000', 220, pageHeight - 45, { width: 150, align: 'center' });
  doc.text('NFS, une communauté, une vision, un avenir.', 390, pageHeight - 49, { width: 170, align: 'right' });
  doc.restore();
};

const receiptRows = (receipt: any, memberName: string, timezone: string) => {
  const snapshot: any = receipt.snapshot || {};
  const rows = [
    ['TRANSACTION N°', snapshot.reference || receipt.receiptNumber],
    ["DATE DE L'OPERATION", formatDate(snapshot.occurredAt || receipt.createdAt, timezone)],
    ['NOM DU MEMBRE', memberName],
    ["TYPE D'OPERATION", snapshot.type || receipt.type],
    ['MOYEN DE PAIEMENT', snapshot.paymentMethod],
    ['MONTANT', money(snapshot.amount, snapshot.currency)],
  ];
  if (Number(snapshot.fees || 0) > 0) rows.push(['FRAIS', money(snapshot.fees, snapshot.currency)]);
  if (Number(snapshot.total || 0) > 0 && Number(snapshot.total) !== Number(snapshot.amount)) rows.push(['TOTAL', money(snapshot.total, snapshot.currency)]);
  if (snapshot.source) rows.push(['SOURCE', snapshot.source]);
  if (snapshot.destination) rows.push(['DESTINATION', snapshot.destination]);
  rows.push(["MOTIF DE L'OPERATION", snapshot.purpose]);
  rows.push(['STATUT', snapshot.status || 'CONFIRMEE']);
  return rows.map(([label, value]) => [safeText(label), safeText(value)]);
};

export const generateReceiptPdf = (receipt: any, user: any): Promise<Buffer> => new Promise((resolve, reject) => {
  const memberName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone || 'Membre NFS';
  const timezone = user.timezone || 'Africa/Douala';
  const rows = receiptRows(receipt, memberName, timezone);
  const [mainTitle, subTitle] = titleLines(receipt.title);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: receipt.title,
      Author: 'New Financial Services',
      Subject: receipt.receiptNumber,
      CreationDate: receipt.createdAt || new Date(),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  drawBrand(doc);
  doc.font('Helvetica-Bold').fontSize(34).fillColor(BLUE).text(mainTitle, 55, 168, { width: 485, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(BLUE).text(subTitle, 55, 208, { width: 485, align: 'center' });
  doc.strokeColor(GOLD).lineWidth(1).moveTo(82, 196).lineTo(190, 196).stroke();
  doc.moveTo(405, 196).lineTo(513, 196).stroke();
  doc.fillColor(GOLD).circle(287, 247, 4).fill().circle(303, 247, 4).fill().circle(319, 247, 4).fill();
  doc.font('Helvetica').fontSize(11).fillColor(NAVY).text('Nous vous remercions pour votre confiance.', 70, 270, { width: 455, align: 'center' });
  doc.text('Ce reçu confirme le traitement définitif de votre opération.', 70, 288, { width: 455, align: 'center' });

  const tableX = 32;
  const tableY = 325;
  const tableWidth = 531;
  const labelWidth = 205;
  const rowHeight = Math.min(43, Math.max(29, (doc.page.height - 483) / rows.length));
  const tableHeight = rowHeight * rows.length;
  doc.roundedRect(tableX, tableY, tableWidth, tableHeight, 12).fillAndStroke('#FFFFFF', BORDER);
  rows.forEach(([label, value], index) => {
    const y = tableY + index * rowHeight;
    if (index > 0) doc.strokeColor(BORDER).lineWidth(0.7).moveTo(tableX, y).lineTo(tableX + tableWidth, y).stroke();
    doc.fillColor(PALE_BLUE).roundedRect(tableX + 8, y + 6, 30, rowHeight - 12, 8).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLUE).text(String(index + 1).padStart(2, '0'), tableX + 8, y + rowHeight / 2 - 5, { width: 30, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLUE).text(label, tableX + 48, y + 11, { width: labelWidth - 50, height: rowHeight - 12, ellipsis: true });
    doc.strokeColor(BORDER).lineWidth(0.7).moveTo(tableX + labelWidth, y + 7).lineTo(tableX + labelWidth, y + rowHeight - 7).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(value, tableX + labelWidth + 15, y + 10, { width: tableWidth - labelWidth - 25, height: rowHeight - 12, ellipsis: true });
  });

  const verificationY = tableY + tableHeight + 17;
  doc.roundedRect(100, verificationY - 5, 20, 20, 6).fill(BLUE);
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF').text('OK', 100, verificationY + 1, { width: 20, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Ce reçu est établi électroniquement et ne nécessite pas de signature.', 125, verificationY, { width: 370, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Vérification : ${receipt.verificationCode}  |  Reçu : ${receipt.receiptNumber}`, 70, verificationY + 18, { width: 455, align: 'center' });

  drawFooter(doc);
  doc.end();
});

export const receiptPdfHash = (pdf: Buffer) => crypto.createHash('sha256').update(pdf).digest('hex');
