import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany();
  console.log('TOTAL USERS:', users.length);
  users.forEach(u => console.log(`- ${u.firstName} ${u.lastName}: ${JSON.stringify(u.roles)}`));
  await prisma.$disconnect();
}
main();
