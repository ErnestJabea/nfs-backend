import crypto from 'crypto';
import prisma from '../utils/prisma';
import { getOtpHmacSecret } from '../config/security';

export const hashPasswordResetCode = (email: string, code: string) => crypto
  .createHmac('sha256', getOtpHmacSecret())
  .update(`password-reset:${email}:${code}`)
  .digest('hex');

export const issuePasswordResetCode = async (email: string) => {
  const code = crypto.randomInt(10_000_000, 100_000_000).toString();
  await prisma.passwordReset.deleteMany({ where: { email } });
  await prisma.passwordReset.create({
    data: {
      email,
      code: hashPasswordResetCode(email, code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return code;
};
