const { MongoClient } = require('mongodb');
require('dotenv').config();

async function deepInspect() {
  const url = process.env.DATABASE_URL;
  const client = new MongoClient(url);

  try {
    await client.connect();
    const db = client.db();
    
    const collections = await db.listCollections().toArray();
    console.log('--- Statistiques des collections ---');
    
    for (let col of collections) {
      const count = await db.collection(col.name).countDocuments();
      console.log(`${col.name}: ${count} documents`);
      if (count > 0 && col.name !== 'User') {
        const sample = await db.collection(col.name).findOne();
        console.log(`Exemple de ${col.name}:`, JSON.stringify(sample, null, 2).substring(0, 200));
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

deepInspect();
