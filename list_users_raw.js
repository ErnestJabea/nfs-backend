const { MongoClient } = require('mongodb');
require('dotenv').config();

async function main() {
  const client = new MongoClient(process.env.DATABASE_URL);
  try {
    await client.connect();
    const db = client.db();
    const users = await db.collection('users').find().limit(5).toArray();
    console.log(JSON.stringify(users.map(u => ({ phone: u.phone, firstName: u.firstName, lastName: u.lastName })), null, 2));
  } finally {
    await client.close();
  }
}

main().catch(console.error);
