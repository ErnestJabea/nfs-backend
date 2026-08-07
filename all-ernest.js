
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { userId: "68a1ed0337bfa79868c66046" }
  });
  console.log("ALL TRANSACTIONS FOR ERNEST:", txs.length);
  for (const t of txs) {
     console.log("Tx:", t.id, "purpose:", t.purpose, "operation:", t.operation);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());

