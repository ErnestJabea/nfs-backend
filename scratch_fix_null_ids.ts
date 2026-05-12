import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const generateAccountNumber = () => Math.floor(1000000000 + Math.random() * 9000000000).toString();
const generateUniqueKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();

async function main() {
  const users = await prisma.user.findMany();

  console.log(`Checking ${users.length} users...`);

  for (const user of users) {
    if (!user.accountNumber || !user.uniqueKey) {
      console.log(`Updating user ${user.firstName} ${user.lastName}...`);
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            accountNumber: user.accountNumber || generateAccountNumber(),
            uniqueKey: user.uniqueKey || generateUniqueKey()
          }
        });
      } catch (err) {
        console.error(`Failed to update user ${user.id}:`, err);
      }
    }
  }

  console.log('Done!');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});
