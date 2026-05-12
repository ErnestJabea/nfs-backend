const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const user = await prisma.user.findUnique({ where: { phone: '699295631' } });
  if (!user) return console.log('User not found');
  console.log('User details:', {
    phone: user.phone,
    email: user.email,
    createdAt: user.createdAt,
    hashedPassword: user.password
  });
}
run().catch(console.error).finally(() => prisma.$disconnect());
