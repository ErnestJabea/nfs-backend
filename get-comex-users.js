const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      isActivated: true,
      accreditationGroupId: true,
      accreditationGroup: { select: { name: true } }
    }
  });
  console.log("=== USERS IN DATABASE ===");
  console.log(JSON.stringify(users, null, 2));

  const groups = await prisma.accreditationGroup.findMany({
    include: { users: true }
  }).catch(() => []);
  console.log("=== GROUPS IN DATABASE ===");
  console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
