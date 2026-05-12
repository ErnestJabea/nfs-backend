const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const tx = await prisma.transaction.findFirst({ where: { purpose: 'test raw' } });
    if(tx) {
        const res = await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'SUCCESS' }
        });
        console.log('update success', res);
    }
  } catch(e) {
    console.error(e.message);
  }
}
main();
