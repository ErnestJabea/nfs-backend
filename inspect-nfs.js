const { MongoClient } = require('mongodb');
require('dotenv').config();

async function inspectNFSDatabase() {
  // On force la connexion sur la base 'nfs'
  const url = process.env.DATABASE_URL.replace('/nfsapp', '/nfs');
  const client = new MongoClient(url);

  try {
    await client.connect();
    const db = client.db('nfs');
    
    console.log('--- Collections dans la base "nfs" ---');
    const collections = await db.listCollections().toArray();
    for (let col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`${col.name}: ${count} documents`);
    }

    console.log('\n--- Exemple d\'utilisateur dans "nfs" ---');
    const user = await db.collection('users').findOne(); // Test avec 'users' au pluriel
    if (!user) {
        const userSingular = await db.collection('User').findOne();
        console.log('Recherche via "User" (singulier) :', JSON.stringify(userSingular, null, 2).substring(0, 500));
    } else {
        console.log('Recherche via "users" (pluriel) :', JSON.stringify(user, null, 2).substring(0, 500));
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

inspectNFSDatabase();
