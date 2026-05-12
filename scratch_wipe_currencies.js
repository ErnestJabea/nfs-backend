require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not found in .env");
    return;
  }
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('currencies');
    const result = await collection.deleteMany({});
    console.log(`Deleted ${result.deletedCount} documents from currencies collection.`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
