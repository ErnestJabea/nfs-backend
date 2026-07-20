import fs from 'node:fs/promises';
import path from 'node:path';
import { generateReceiptPdf } from '../src/services/receiptService';

const run = async () => {
  const createdAt = new Date('2026-07-16T14:25:30.000Z');
  const pdf = await generateReceiptPdf({
    title: 'Recu de remboursement de credit',
    receiptNumber: 'NFS-20260716-11326674AA',
    verificationCode: 'A1B2C3D4E5F60718293A',
    createdAt,
    snapshot: {
      reference: '11326674',
      occurredAt: createdAt.toISOString(),
      type: 'REMBOURSEMENT DE CREDIT',
      paymentMethod: 'MOBILE MONEY',
      amount: 186_617,
      currency: 'XAF',
      fees: 1_000,
      total: 187_617,
      source: 'Mobile Money ****6496',
      destination: 'Credit NFS ****2674',
      purpose: 'Remboursement credit du 06/04/2026',
      status: 'CONFIRMEE',
    },
  }, {
    firstName: 'Ngos Reine',
    lastName: 'Laurentine',
    timezone: 'Africa/Douala',
  });
  const outputDir = path.resolve('output/pdf');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'nfs-recu-exemple.pdf');
  await fs.writeFile(outputPath, pdf);
  process.stdout.write(`${outputPath}\n`);
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
