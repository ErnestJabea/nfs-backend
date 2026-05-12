require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('cotisations');
    
    const result = await collection.updateMany(
      { $or: [ { status: null }, { status: { $exists: false } } ] },
      { $set: { status: 'ACTIF', currency: 'XAF', frequency: 'MONTHLY' } }
    );
    
    console.log(`Updated ${result.modifiedCount} groups.`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
