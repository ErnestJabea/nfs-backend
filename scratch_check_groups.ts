import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const groups = await prisma.cotisationGroup.findMany();
    console.log(`Groups found: ${groups.length}`);
    console.log(JSON.stringify(groups, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
