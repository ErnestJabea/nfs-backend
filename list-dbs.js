const { MongoClient } = require('mongodb');
require('dotenv').config();

async function listDBs() {
  const url = process.env.DATABASE_URL;
  const client = new MongoClient(url);

  try {
    await client.connect();
    const adminDB = client.db().admin();
    const dbs = await adminDB.listDatabases();
    console.log('--- Bases de données sur le serveur ---');
    console.log(dbs.databases.map(db => `${db.name} (${db.sizeOnDisk} bytes)`));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

listDBs();
