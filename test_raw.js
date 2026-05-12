const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const res = await prisma.$runCommandRaw({
      insert: 'transactions',
      documents: [{ purpose: 'test raw', amount: 100, validatedBy: [] }]
    });
    console.log('success', res);
  } catch(e) {
    console.error(e.message);
  }
}
main();
