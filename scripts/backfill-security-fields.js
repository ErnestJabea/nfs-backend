require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const users = await prisma.$runCommandRaw({
    update: 'users',
    updates: [
      { q: { tokenVersion: { $exists: false } }, u: { $set: { tokenVersion: 0 } }, multi: true },
      { q: { preferredTheme: { $exists: false } }, u: { $set: { preferredTheme: 'SYSTEM' } }, multi: true },
      { q: { locale: { $exists: false } }, u: { $set: { locale: 'fr' } }, multi: true },
      { q: { timezone: { $exists: false } }, u: { $set: { timezone: 'Africa/Douala' } }, multi: true },
      { q: { emailNotifications: { $exists: false } }, u: { $set: { emailNotifications: true } }, multi: true },
      { q: { transactionNotifications: { $ne: true } }, u: { $set: { transactionNotifications: true } }, multi: true },
      { q: { securityNotifications: { $exists: false } }, u: { $set: { securityNotifications: true } }, multi: true },
      { q: { pushNotifications: { $exists: false } }, u: { $set: { pushNotifications: true } }, multi: true },
      { q: { balancePrivacy: { $exists: false } }, u: { $set: { balancePrivacy: false } }, multi: true },
      { q: { mfaEnabled: { $exists: false } }, u: { $set: { mfaEnabled: false } }, multi: true },
      { q: { mfaRecoveryCodeHashes: { $exists: false } }, u: { $set: { mfaRecoveryCodeHashes: [] } }, multi: true },
    ],
  });
  const resets = await prisma.$runCommandRaw({
    update: 'password_resets',
    updates: [{
      q: { attempts: { $exists: false } },
      u: { $set: { attempts: 0 } },
      multi: true,
    }],
  });
  console.log('Security field backfill completed.', {
    usersMatched: users.n || 0,
    passwordResetsMatched: resets.n || 0,
  });
}

run()
  .catch((error) => {
    console.error('Security field backfill failed:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
