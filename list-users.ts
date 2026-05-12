import prisma from './src/utils/prisma';

async function listAll() {
  try {
    const users = await prisma.user.findMany({
      select: {
        phone: true,
        role: true,
        firstName: true,
        lastName: true
      }
    });
    console.log('--- Liste des utilisateurs en base ---');
    console.table(users);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

listAll();
