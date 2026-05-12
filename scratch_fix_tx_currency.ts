import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.transaction.updateMany({
      where: {
        OR: [
          { currency: null },
          { currency: '' }
        ]
      },
      data: {
        currency: 'XAF'
      }
    });
    console.log(`Updated ${result.count} transactions to XAF`);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
