const { MongoClient } = require('mongodb');

const oldUrl = "mongodb://admin:CNyEzmdS5e38L4AMZR6W@82.165.212.140:27020/nfs?authSource=admin";
// URL-encode the password which seems to contain a special character (@)
const newUrl = "mongodb+srv://ejabbing:Ppsi!738%40@cluster0.9lqenuo.mongodb.net/nfs?retryWrites=true&w=majority";

async function migrate() {
  const sourceClient = new MongoClient(oldUrl);
  const targetClient = new MongoClient(newUrl);

  try {
    console.log("Connecting to source database...");
    await sourceClient.connect();
    const sourceDb = sourceClient.db("nfs");

    console.log("Connecting to target database...");
    await targetClient.connect();
    const targetDb = targetClient.db("nfs");

    const collections = await sourceDb.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    console.log(`Found ${collectionNames.length} collections:`, collectionNames);

    for (const name of collectionNames) {
      if (name === 'system.views' || name === 'system.profile') continue;
      
      console.log(`\nMigrating collection: ${name}`);
      const docs = await sourceDb.collection(name).find({}).toArray();
      
      if (docs.length === 0) {
        console.log(`- 0 documents found. Skipping.`);
        continue;
      }
      
      console.log(`- Found ${docs.length} documents. Copying...`);
      // Try to clear the target collection first if it exists
      try {
        await targetDb.collection(name).deleteMany({});
      } catch (e) {
        // collection might not exist yet, that's fine
      }
      
      const result = await targetDb.collection(name).insertMany(docs);
      console.log(`- Successfully inserted ${result.insertedCount} documents into ${name}.`);
    }

    console.log("\nMigration completed successfully!");

  } catch (err) {
    console.error("\nMigration failed:", err);
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

migrate();
