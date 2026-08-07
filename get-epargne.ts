import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ select: { accountIds: true } });
  const allAccountIds: string[] = [];
  for (const u of users) {
    if (u.accountIds) allAccountIds.push(...u.accountIds);
  }
  const epargneSum = await prisma.account.aggregate({
    where: { id: { in: allAccountIds }, type: 'EPARGNE' },
    _sum: { currentBalance: true }
  });
  console.log('TOTAL EPARGNE:', epargneSum._sum.currentBalance);
}
main().then(() => prisma.$disconnect()).catch(() => prisma.$disconnect());
