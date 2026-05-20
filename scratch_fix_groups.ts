import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.cotisationGroup.updateMany({
      where: {
        OR: [
          { status: null },
          { currency: null }
        ]
      },
      data: {
        status: 'ACTIF',
        currency: 'XAF',
        frequency: 'MONTHLY'
      }
    });
    console.log(`Fixed ${result.count} groups.`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
