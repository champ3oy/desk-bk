const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI =
  'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';

async function checkTicketStatus() {
  await mongoose.connect(MONGODB_URI);

  // The last message ID we got from the test script
  const messageId = '697f876db27f19e86ee15704';

  const message = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });

  if (!message) {
    console.log('Message NOT found');
    await mongoose.disconnect();
    return;
  }

  console.log('--- Message Found ---');
  console.log(`Content: ${message.content}`);
  console.log(`Channel: ${message.channel}`);
  console.log(`Author Type: ${message.authorType}`);

  const thread = await mongoose.connection.db
    .collection('threads')
    .findOne({ _id: message.threadId });
  if (thread) {
    console.log('\n--- Thread Found ---');
    console.log(`Ticket ID: ${thread.ticketId}`);

    const ticket = await mongoose.connection.db
      .collection('tickets')
      .findOne({ _id: thread.ticketId });
    if (ticket) {
      console.log('\n--- Ticket Found ---');
      console.log(`Subject: ${ticket.subject}`);
      console.log(`Status: ${ticket.status}`);
      console.log(`Sentiment: ${ticket.sentiment}`);
      console.log(`Is AI Escalated: ${ticket.isAiEscalated}`);
      console.log(`AI Escalation Reason: ${ticket.aiEscalationReason}`);
    }

    const allMessages = await mongoose.connection.db
      .collection('messages')
      .find({ threadId: thread._id })
      .sort({ createdAt: 1 })
      .toArray();
    console.log('\n--- All Messages in Thread ---');
    allMessages.forEach((msg) => {
      console.log(
        `[${msg.authorType}] ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''} (ID: ${msg._id})`,
      );
    });
  }

  await mongoose.disconnect();
}

checkTicketStatus().catch(console.error);
