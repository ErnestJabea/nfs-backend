import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const groups = await prisma.tontineGroup.findMany();
  console.log(`Nombre de groupes de tontine : ${groups.length}`);
  groups.forEach(g => console.log(`- ${g.name} (${g.id})`));
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});
