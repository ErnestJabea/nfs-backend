const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  users.forEach(u => console.log(u.phone, u.email, u.createdAt));
}
run().catch(console.error).finally(() => prisma.$disconnect());
