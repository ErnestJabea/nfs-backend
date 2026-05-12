const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.user.delete({
    where: { id: '69fd429de7c6c0a2951ed34a' }
  });
  console.log('Deleted old duplicate user');
}
run().catch(console.error).finally(() => prisma.$disconnect());
