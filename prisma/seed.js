const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient({
  datasource: {
    url: process.env.DATABASE_URL
  }
});

async function main() {
  const adminPhone = '00000000';
  const adminPassword = 'adminpassword';
  
  console.log('Tentative de création de l\'admin...');
  console.log('URL DB:', process.env.DATABASE_URL ? 'OK' : 'MANQUANTE');

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
    console.error('Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
