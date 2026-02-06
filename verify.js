const { MongoClient, ObjectId } = require('mongodb');
console.log('Script started');
async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected!');
    const db = client.db();
    const ticket = await db.collection('tickets').findOne({ _id: new ObjectId('6985e56a2c8ce3b20b910558') });
    
    if (ticket) {
      console.log('--- TICKET VERIFIED ---');
      console.log('ID:', ticket._id);
      console.log('displayId:', ticket.displayId);
      console.log('ticketNumber:', ticket.ticketNumber);
      console.log('-----------------------');
    } else {
      console.log('Ticket not found in DB');
    }
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    console.log('Closing client...');
    await client.close();
  }
}
run();
