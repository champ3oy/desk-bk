import { MongoClient } from 'mongodb';

async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const tickets = await db.collection('tickets').find({ createdAt: { $gt: tenMinutesAgo } }).toArray();
    console.log(`Tickets created in last 10 mins: ${tickets.length}`);
    tickets.forEach(t => {
      console.log(`ID: ${t._id}, displayId: ${t.displayId}, createdAt: ${t.createdAt}`);
    });
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
