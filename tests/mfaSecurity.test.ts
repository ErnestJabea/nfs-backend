import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoginMfaChallenge,
  createOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  findRecoveryHash,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyLoginMfaChallenge,
  verifyTotp,
} from '../src/security/mfaService';
import { passwordPolicyError } from '../src/security/passwordPolicy';
import { getSecurityOtpDeliveryMode } from '../src/services/otpDeliveryService';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
process.env.OTP_HMAC_SECRET = 'test-otp-secret-that-is-longer-than-thirty-two-characters';
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('verifies the RFC 6238 SHA-1 vector truncated to six digits', () => {
  // Base32("12345678901234567890") and RFC timestamp 59 seconds.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '287082', 59_000), 1);
  assert.equal(verifyTotp(secret, '287083', 59_000), null);
});

test('encrypts MFA secrets with authenticated encryption', () => {
  const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP');
  assert.notEqual(encrypted, 'JBSWY3DPEHPK3PXP');
  assert.equal(decryptMfaSecret(encrypted), 'JBSWY3DPEHPK3PXP');
  const parts = encrypted.split(':');
  const alteredTag = Buffer.from(parts[3], 'base64url');
  alteredTag[0] ^= 1;
  parts[3] = alteredTag.toString('base64url');
  assert.throws(() => decryptMfaSecret(parts.join(':')));
});

test('issues compatible otpauth URIs without vendor lock-in', () => {
  const uri = createOtpAuthUri('JBSWY3DPEHPK3PXP', 'client@example.com');
  assert.match(uri, /^otpauth:\/\/totp\/NFS%3Aclient%40example\.com\?/);
  assert.match(uri, /issuer=NFS/);
  assert.match(uri, /period=30/);
});

test('generates single-use recovery material stored only as hashes', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  const hashes = codes.map(code => hashRecoveryCode('user-1', code));
  assert.equal(findRecoveryHash('user-1', codes[0].toLowerCase(), hashes), hashes[0]);
  assert.equal(findRecoveryHash('user-2', codes[0], hashes), null);
});

test('binds login challenges to the MFA audience and user', () => {
  const token = createLoginMfaChallenge({ id: 'user-1', tokenVersion: 4 });
  const decoded = verifyLoginMfaChallenge(token);
  assert.equal(decoded.userId, 'user-1');
  assert.equal(decoded.tokenVersion, 4);
});

test('enforces long passphrases and blocks common passwords', () => {
  assert.match(passwordPolicyError('short-password') || '', /15/);
  assert.equal(passwordPolicyError('une phrase de passe longue et unique'), null);
  assert.notEqual(passwordPolicyError('1234567890'), null);
});

test('never exposes development OTP codes in production', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevExposure = process.env.OTP_DEV_EXPOSE_CODE;
  const previousSmsWebhook = process.env.OTP_SMS_WEBHOOK_URL;
  try {
    delete process.env.OTP_SMS_WEBHOOK_URL;
    process.env.OTP_DEV_EXPOSE_CODE = 'true';
    process.env.NODE_ENV = 'production';
    assert.equal(getSecurityOtpDeliveryMode(), null);
    process.env.NODE_ENV = 'test';
    assert.equal(getSecurityOtpDeliveryMode(), 'development');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousDevExposure === undefined) delete process.env.OTP_DEV_EXPOSE_CODE; else process.env.OTP_DEV_EXPOSE_CODE = previousDevExposure;
    if (previousSmsWebhook === undefined) delete process.env.OTP_SMS_WEBHOOK_URL; else process.env.OTP_SMS_WEBHOOK_URL = previousSmsWebhook;
  }
});
