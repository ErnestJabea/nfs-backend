require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('transactions');
    
    // Update documents where currency field is missing or null
    const result = await collection.updateMany(
      { currency: { $exists: false } },
      { $set: { currency: 'XAF' } }
    );
    
    const result2 = await collection.updateMany(
      { currency: null },
      { $set: { currency: 'XAF' } }
    );

    console.log(`Updated ${result.modifiedCount + result2.modifiedCount} transactions to XAF.`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
