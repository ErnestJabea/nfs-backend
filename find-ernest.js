
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: "Ernest", mode: "insensitive" } },
        { lastName: { contains: "EYIDI", mode: "insensitive" } }
      ]
    }
  });

  console.log("Found users:", users.map(u => ({ id: u.id, name: u.firstName + " " + u.lastName })));

  if (users.length > 0) {
    for (const u of users) {
      const txs = await prisma.transaction.findMany({
        where: { userId: u.id, purpose: "EPARGNE" }
      });
      console.log(`Transactions for ${u.firstName} ${u.lastName}:`, txs);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());

