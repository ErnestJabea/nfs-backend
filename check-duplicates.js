const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');

async function run() {
  const users = await prisma.user.findMany({
    where: { phone: '699295631' },
    orderBy: { createdAt: 'desc' }
  });
  
  for (let u of users) {
    console.log(`User ${u.id} - ${u.createdAt}`);
    const match = await bcrypt.compare('MQM7D5', u.password);
    console.log(`Password match MQM7D5: ${match}`);
  }
}
run().catch(console.error).finally(() => prisma.$disconnect());
