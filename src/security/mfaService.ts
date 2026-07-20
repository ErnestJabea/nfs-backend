import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret, getMfaEncryptionKey, getOtpHmacSecret } from '../config/security';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOTP_STEP_SECONDS = 30;

const base32Encode = (buffer: Buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return output;
};

const base32Decode = (value: string) => {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const encryptMfaSecret = (secret: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
};

export const decryptMfaSecret = (payload: string) => {
  const [version, ivValue, encryptedValue, tagValue] = String(payload || '').split(':');
  if (version !== 'v1' || !ivValue || !encryptedValue || !tagValue) throw new Error('Invalid encrypted MFA secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMfaEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const totpAtStep = (secret: string, step: number) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, '0');
};

export const verifyTotp = (secret: string, submittedCode: unknown, now = Date.now()) => {
  const code = String(submittedCode || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    if (safeEqual(totpAtStep(secret, step), code)) return step;
  }
  return null;
};

export const createOtpAuthUri = (secret: string, accountLabel: string) => {
  const issuer = 'NFS';
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query.toString()}`;
};

export const generateConfirmationOtp = () => crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');

export const hashConfirmationOtp = (userId: string, code: string) => crypto
  .createHmac('sha256', getOtpHmacSecret())
  .update(`mfa-enrollment:${userId}:${code}`)
  .digest('base64url');

export const confirmationOtpMatches = (userId: string, code: string, storedHash: string) => safeEqual(
  hashConfirmationOtp(userId, code),
  storedHash,
);

export const generateRecoveryCodes = (count = 10) => Array.from({ length: count }, () => {
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
});

export const hashRecoveryCode = (userId: string, code: string) => crypto
  .createHmac('sha256', getOtpHmacSecret())
  .update(`mfa-recovery:${userId}:${String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`)
  .digest('base64url');

export const findRecoveryHash = (userId: string, code: string, storedHashes: string[]) => {
  const candidate = hashRecoveryCode(userId, code);
  return storedHashes.find(hash => safeEqual(hash, candidate)) || null;
};

export const createLoginMfaChallenge = (user: { id: string; tokenVersion: number }) => jwt.sign(
  {
    sub: user.id,
    userId: user.id,
    tokenVersion: user.tokenVersion,
    purpose: 'login_mfa',
    nonce: crypto.randomBytes(16).toString('base64url'),
  },
  getJwtSecret(),
  { expiresIn: 300, audience: 'nfs-mfa', issuer: 'nfs-api' },
);

export const verifyLoginMfaChallenge = (token: string) => {
  const decoded = jwt.verify(token, getJwtSecret(), { audience: 'nfs-mfa', issuer: 'nfs-api' }) as any;
  if (decoded?.purpose !== 'login_mfa' || !decoded?.userId) throw new Error('Invalid MFA challenge.');
  return decoded as { userId: string; tokenVersion: number };
};
