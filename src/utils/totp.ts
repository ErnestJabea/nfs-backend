import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < bytes.length; i++) {
    secret += BASE32_ALPHABET[bytes[i] % 32];
  }
  return secret;
}

function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bits: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_ALPHABET.indexOf(clean[i]);
    if (val === -1) continue;
    for (let bit = 4; bit >= 0; bit--) {
      bits.push((val >> bit) & 1);
    }
  }

  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i + b];
    }
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, timeStepWindow?: number): string {
  const step = 30; // 30 seconds step
  const time = Math.floor((timeStepWindow !== undefined ? timeStepWindow : Date.now() / 1000) / step);
  const buffer = base32ToBuffer(secret);

  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(time));

  const hmac = crypto.createHmac('sha1', buffer);
  hmac.update(timeBuffer);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0xf;
  const code = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % 1000000;

  return code.toString().padStart(6, '0');
}

export function verifyTotpCode(secret: string, inputCode: string, window = 1): boolean {
  if (!secret || !inputCode) return false;
  const cleanInput = String(inputCode).trim();
  if (cleanInput.length !== 6 || !/^\d+$/.test(cleanInput)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const timeStep = 30;

  for (let i = -window; i <= window; i++) {
    const timeForStep = nowSeconds + i * timeStep;
    const expectedCode = generateTotpCode(secret, timeForStep);
    if (crypto.timingSafeEqual(Buffer.from(expectedCode), Buffer.from(cleanInput))) {
      return true;
    }
  }

  return false;
}

export function generateTotpUri(secret: string, accountName: string, issuer = 'NFS Backoffice'): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
