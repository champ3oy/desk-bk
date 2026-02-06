import { MongoClient } from 'mongodb';

async function run() {
  const uri = 'mongodb://localhost:27017/morpheus-desk';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const tickets = await db.collection('tickets').find({ displayId: { $exists: true } }).toArray();
    console.log(`Tickets with displayId: ${tickets.length}`);
    tickets.forEach(t => {
      console.log(`ID: ${t._id}, displayId: ${t.displayId}, createdAt: ${t.createdAt}`);
    });
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
