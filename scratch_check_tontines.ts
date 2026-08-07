import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.cotisationGroup.findMany();
  for (const g of groups) {
    console.log("=== Group ===");
    console.log("ID:", g.id);
    console.log("Name:", g.name);
    console.log("Status:", g.status);
    console.log("maxParticipants:", g.maxParticipants);
    console.log("nb_participant:", g.nb_participant);
    console.log("memberIds length:", g.memberIds?.length);
    console.log("memberIds:", g.memberIds);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
});
