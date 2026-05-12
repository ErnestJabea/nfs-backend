const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const configs = [
    { code: 'CT1', rate: 3.99, duration: 30 },
    { code: 'CT2', rate: 7.98, duration: 60 },
    { code: 'CT3', rate: 11.97, duration: 90 },
    { code: 'MT4', rate: 13.99, duration: 120 },
    { code: 'MT5', rate: 16.49, duration: 150 },
    { code: 'LT6', rate: 18.99, duration: 180 },
    { code: 'LC', rate: 1.99, duration: 30 },
    { code: 'CONS7', rate: 21.99, duration: 210 },
    { code: 'CONS8', rate: 24.99, duration: 240 },
    { code: 'CONS9', rate: 27.99, duration: 270 },
    { code: 'ISL', rate: 0.00, duration: 365 },
  ];

  console.log('Seeding loan configs...');

  for (const config of configs) {
    await prisma.loanConfig.upsert({
      where: { code: config.code },
      update: config,
      create: config,
    });
    console.log(`Upserted ${config.code}`);
  }

  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
