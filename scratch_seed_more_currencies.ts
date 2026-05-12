import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const currencies = [
      { code: 'EUR', symbol: '€', name: 'Euro' },
      { code: 'USD', symbol: '$', name: 'US Dollar' },
      { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' }
    ];

    for (const c of currencies) {
      await prisma.currency.upsert({
        where: { code: c.code },
        update: { isActive: true },
        create: { ...c, isActive: true }
      });
      console.log(`Ensured currency exists: ${c.code}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
