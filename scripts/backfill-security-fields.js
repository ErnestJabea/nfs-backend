const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  const users = await prisma.$runCommandRaw({
    update: 'users',
    updates: [{
      q: { tokenVersion: { $exists: false } },
      u: { $set: { tokenVersion: 0 } },
      multi: true,
    }],
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
