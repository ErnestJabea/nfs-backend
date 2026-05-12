const { MongoClient } = require('mongodb');
require('dotenv').config();

async function inspectDB() {
  const url = process.env.DATABASE_URL;
  const client = new MongoClient(url);

  try {
    await client.connect();
    const db = client.db();
    
    console.log('--- Collections disponibles ---');
    const collections = await db.listCollections().toArray();
    console.log(collections.map(c => c.name));

    console.log('\n--- Exemple d\'utilisateur (Brut) ---');
    // On cherche un utilisateur qui n'est pas l'admin 00000000
    const user = await db.collection('User').findOne({ phone: { $ne: '00000000' } });
    console.log(JSON.stringify(user, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

inspectDB();
