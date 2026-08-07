const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'ernestjabea@gmail.com' } });
  
  const loans = await prisma.loan.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 3
  });

  console.log('--- DERNIERS CRÉDITS CRÉÉS ---');
  console.log(JSON.stringify(loans, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
