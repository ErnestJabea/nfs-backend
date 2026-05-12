const { MongoClient } = require('mongodb');
require('dotenv').config();

async function inspectTransactions() {
  const url = process.env.DATABASE_URL;
  const client = new MongoClient(url);

  try {
    await client.connect();
    const db = client.db();
    console.log('--- Exemple de transaction réelle ---');
    const tx = await db.collection('transactions').findOne();
    console.log(JSON.stringify(tx, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

inspectTransactions();
