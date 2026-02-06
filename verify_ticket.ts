import { MongoClient, ObjectId } from 'mongodb';

async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const ticket = await db.collection('tickets').findOne({ _id: new ObjectId('6985e56a2c8ce3b20b910558') });
    
    if (ticket) {
      console.log('--- TICKET FOUND ---');
      console.log('ID:', ticket._id);
      console.log('displayId:', ticket.displayId);
      console.log('ticketNumber:', ticket.ticketNumber);
      console.log('subject:', ticket.subject);
      console.log('--------------------');
    } else {
      console.log('Ticket not found!');
    }
  } finally {
    await client.close();
  }
}

run().catch(console.dir);
