const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function createAdmin() {
  const url = process.env.DATABASE_URL;
  const client = new MongoClient(url);
  const phone = '00000000';
  const password = 'adminpassword';

  try {
    await client.connect();
    console.log('Connecté à MongoDB...');
    const db = client.db();
    const users = db.collection('users'); // Utilise 'users' au pluriel

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await users.updateOne(
      { phone },
      { 
        $set: { 
          phone, 
          password: hashedPassword, 
          firstName: 'Super', 
          lastName: 'Admin', 
          roles: ['ADMIN'], // Format liste de rôles
          activated: true, // Champ d'activation réel
          verified: true,
          referralCode: 'ADMIN01',
          createdAt: new Date(),
          updatedAt: new Date()
        } 
      },
      { upsert: true }
    );

    console.log('Administrateur créé/mis à jour avec succès dans la base REELLE !');
    console.log('Résultat :', result);
  } catch (err) {
    console.error('Erreur :', err);
  } finally {
    await client.close();
  }
}

createAdmin();
