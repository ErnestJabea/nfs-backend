const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const adminPhone = '00000000';
  const adminPassword = 'adminpassword';
  
  const existingAdmin = await prisma.user.findUnique({
    where: { phone: adminPhone },
  });

  if (existingAdmin) {
    console.log('L\'administrateur existe déjà.');
    return;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const referralCode = 'ADMIN01';

  await prisma.user.create({
    data: {
      phone: adminPhone,
      password: hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'ADMIN',
      isActivated: true,
      referralCode,
    },
  });

  console.log('Administrateur créé avec succès !');
  console.log('Téléphone :', adminPhone);
  console.log('Mot de passe :', adminPassword);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
