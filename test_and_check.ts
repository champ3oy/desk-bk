import { MongoClient, ObjectId } from 'mongodb';
import axios from 'axios';

async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  
  try {
    console.log('1. Creating ticket via webhook...');
    const response = await axios.post('http://localhost:3005/api/webhooks/widget', {
      content: "Hello, testing incremental IDs! " + new Date().toISOString(),
      sessionId: "test_session_" + Date.now(),
      name: "Test Runner",
      email: "test@example.com"
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-channel-id': '69724acec84f3520beda873c'
      }
    });

    console.log('Webhook Response:', response.data);

    // Wait 2 seconds for processing
    console.log('2. Waiting for background processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await client.connect();
    const db = client.db();
    
    console.log('3. Checking most recent ticket...');
    const latestTicket = await db.collection('tickets')
      .find({ organizationId: new ObjectId('69724acec84f3520beda873c') })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (latestTicket.length > 0) {
      const t = latestTicket[0];
      console.log('\n--- VERIFICATION RESULT ---');
      console.log(`Subject:      ${t.subject}`);
      console.log(`internal _id: ${t._id}`);
      console.log(`displayId:    ${t.displayId}`);
      console.log(`ticketNumber: ${t.ticketNumber}`);
      console.log('---------------------------\n');
      
      if (t.displayId) {
        console.log('✅ SUCCESS: Display ID was generated!');
      } else {
        console.log('❌ FAILURE: Display ID is missing.');
      }
    } else {
      console.log('❌ Error: No tickets found for this organization.');
    }
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) console.error('Data:', error.response.data);
  } finally {
    await client.close();
  }
}

run();
