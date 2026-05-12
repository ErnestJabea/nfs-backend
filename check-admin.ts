import prisma from './src/utils/prisma';
import bcrypt from 'bcryptjs';

async function checkAndCreateAdmin() {
  const phone = '00000000';
  const password = 'adminpassword';
  
  console.log('--- Vérification de l\'administrateur ---');
  
  try {
    const admin = await prisma.user.findUnique({
      where: { phone }
    });

    if (admin) {
      console.log('L\'administrateur existe déjà dans la base.');
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { phone },
        data: { password: hashedPassword, role: 'ADMIN' }
      });
      console.log('Mot de passe admin réinitialisé.');
    } else {
      console.log('L\'administrateur n\'existe pas. Création...');
      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.create({
        data: {
          phone,
          password: hashedPassword,
          firstName: 'Super',
          lastName: 'Admin',
          role: 'ADMIN',
          isActivated: true,
          referralCode: 'ADMIN01'
        }
      });
      console.log('Administrateur créé avec succès !');
    }
  } catch (err) {
    console.error('Erreur :', err);
  } finally {
    await prisma.$disconnect();
  }
}

checkAndCreateAdmin();
