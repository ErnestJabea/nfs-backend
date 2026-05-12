require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const user = await prisma.user.findFirst();
    console.log('Connected to:', process.env.DATABASE_URL);
    console.log('User found:', user ? user.firstName : 'null');
    
    // Let's test a write to see if it works on the new DB
    const tx = await prisma.transaction.create({
      data: {
        amount: 1,
        purpose: 'test-atlas',
        status: 'PENDING'
      }
    });
    console.log('Write success!', tx.id);
    
    await prisma.transaction.delete({ where: { id: tx.id } });
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
