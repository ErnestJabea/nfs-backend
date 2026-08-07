const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ take: 3 });
  
  if (users.length < 2) {
    console.log("Not enough users found.");
    return;
  }

  const transactions = [];
  for (let i = 0; i < 3; i++) {
    const user = users[i % users.length];
    const amount = 50000 + (i * 20000); // 50000, 70000, 90000
    const tx = await prisma.transaction.create({
      data: {
        userId: user.id,
        amount: amount,
        purpose: "DEMANDE DE CREDIT_CLASSIQUE",
        status: "PENDING",
        transactionRef: "CREDIT_" + Date.now() + "_" + i,
        createdBy: "SYSTEM_SIMULATION",
        operation: {
          code: "EMPRUNT_CLASSIQUE",
          description: "Simulation demande emprunt"
        }
      }
    });
    transactions.push(tx);
  }

  console.log("Created 3 pending credit transactions:", transactions.map(t => t.id));
}

main().catch(console.error).finally(() => prisma.$disconnect());
