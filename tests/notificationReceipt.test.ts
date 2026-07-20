import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateReceiptPdf,
  receiptNumberForEvent,
  receiptPdfHash,
  verificationCodeForEvent,
} from '../src/services/receiptService';

const createdAt = new Date('2026-07-16T14:25:30.000Z');

test('creates deterministic, non-sequential receipt identifiers', () => {
  const first = receiptNumberForEvent('financial:transaction:123:user:456', createdAt);
  const second = receiptNumberForEvent('financial:transaction:123:user:456', createdAt);
  assert.equal(first, second);
  assert.match(first, /^NFS-20260716-[A-F0-9]{10}$/);
  assert.match(verificationCodeForEvent('event-1', 'user-1'), /^[A-F0-9]{20}$/);
  assert.notEqual(verificationCodeForEvent('event-1', 'user-1'), verificationCodeForEvent('event-1', 'user-2'));
});

test('generates a one-page PDF receipt with a stable integrity hash', async () => {
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

  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 4_000);
  assert.match(receiptPdfHash(pdf), /^[a-f0-9]{64}$/);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
});
