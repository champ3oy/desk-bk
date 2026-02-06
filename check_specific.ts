import { MongoClient, ObjectId } from 'mongodb';

async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const ticket = await db.collection('tickets').findOne({ _id: new ObjectId('6985b508c1eafd804447bd0e') });
    console.log('Ticket found:', !!ticket);
    if (ticket) {
      console.log('displayId:', ticket.displayId);
      console.log('ticketNumber:', ticket.ticketNumber);
      console.log('createdAt:', ticket.createdAt);
    }
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
