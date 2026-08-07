const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ take: 3 });
  
  if (users.length < 2) {
    console.log("Not enough users found.");
    return;
  }

  const loans = [];
  for (let i = 0; i < 3; i++) {
    const user = users[i % users.length];
    const amount = 50000 + (i * 20000); // 50000, 70000, 90000
    const loan = await prisma.loan.create({
      data: {
        userId: user.id,
        amount: amount,
        interestRate: 3.99,
        totalInterest: amount * 0.0399,
        duration: 30,
        purpose: "CREDIT_CLASSIQUE",
        status: "PENDING",
        avalistes: [],
        createdBy: "SYSTEM_SIMULATION"
      }
    });
    loans.push(loan);
  }

  console.log("Created 3 pending loans:", loans.map(l => l.id));
}

main().catch(console.error).finally(() => prisma.$disconnect());
