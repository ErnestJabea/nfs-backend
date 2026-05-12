import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Vérification de la base de données distante ---');
  const userCount = await prisma.user.count();
  console.log(`Nombre d'utilisateurs : ${userCount}`);
  
  const groups = await prisma.tontineGroup.findMany();
  console.log(`Nombre de groupes de tontine : ${groups.length}`);
  
  console.log('--- Fin de vérification ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
