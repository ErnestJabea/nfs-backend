import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const currencies = await prisma.currency.findMany();
    console.log('Existing currencies count:', currencies.length);
    
    // Cleanup duplicates if any
    const seen = new Set();
    for (const c of currencies) {
      if (seen.has(c.code)) {
        console.log('Deleting duplicate:', c.code, c.id);
        await prisma.currency.delete({ where: { id: c.id } });
      } else {
        seen.add(c.code);
      }
    }

    // Ensure XAF exists
    const xaf = await prisma.currency.findUnique({ where: { code: 'XAF' } });
    if (!xaf) {
      await prisma.currency.create({
        data: { code: 'XAF', symbol: 'FCFA', name: 'Franc CFA' }
      });
      console.log('Created XAF currency');
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
