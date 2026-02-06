import { MongoClient, ObjectId } from 'mongodb';

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/morpheus-desk';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const tickets = await db.collection('tickets').find().sort({ createdAt: -1 }).limit(5).toArray();
    console.log('Recent Tickets:');
    tickets.forEach(t => {
      console.log(`ID: ${t._id}, displayId: ${t.displayId}, ticketNumber: ${t.ticketNumber}, subject: ${t.subject}`);
    });
    
    const counters = await db.collection('counters').find().toArray();
    console.log('\nCounters:');
    counters.forEach(c => {
      console.log(`Name: ${c.name}, Org: ${c.organizationId}, Seq: ${c.seq}`);
    });
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
