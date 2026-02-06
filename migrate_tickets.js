const { MongoClient } = require('mongodb');

async function run() {
  const uri = 'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    // Get all organizations
    const orgs = await db.collection('organizations').find().toArray();
    
    for (const org of orgs) {
      console.log(`Processing org: ${org.name} (${org._id})`);
      
      const initials = org.name
        .split(/\s+/)
        .map((word) => word[0])
        .join('')
        .toUpperCase();
      
      // Get all tickets for this org without a displayId, sorted by createdAt
      const tickets = await db.collection('tickets')
        .find({ organizationId: org._id, displayId: { $exists: false } })
        .sort({ createdAt: 1 })
        .toArray();
      
      console.log(`Found ${tickets.length} tickets to migrate for ${org.name}`);
      
      // Get current counter or start from 1
      const counterDoc = await db.collection('counters').findOne({ 
        name: 'ticket_number', 
        organizationId: org._id 
      });
      
      let currentSeq = counterDoc ? counterDoc.seq : 0;
      
      for (const ticket of tickets) {
        currentSeq++;
        const paddedNumber = currentSeq.toString().padStart(6, '0');
        const displayId = `${initials}-${paddedNumber}`;
        
        await db.collection('tickets').updateOne(
          { _id: ticket._id },
          { $set: { ticketNumber: currentSeq, displayId: displayId } }
        );
        console.log(`Migrated Ticket ${ticket._id} -> ${displayId}`);
      }
      
      // Update the counter to match the last assigned number
      await db.collection('counters').updateOne(
        { name: 'ticket_number', organizationId: org._id },
        { $set: { seq: currentSeq } },
        { upsert: true }
      );
      
      console.log(`Updated counter for ${org.name} to ${currentSeq}`);
    }
    
    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.close();
  }
}

run();
