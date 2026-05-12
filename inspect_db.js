const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function main() {
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const transactions = await db.collection('transactions').find().limit(5).toArray();
    console.log(JSON.stringify(transactions, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(console.error);
