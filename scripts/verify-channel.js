const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI =
  'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';

async function verifyChannel() {
  await mongoose.connect(MONGODB_URI);

  // Find the last AI message
  const aiMessage = await mongoose.connection.db
    .collection('messages')
    .findOne({ authorType: 'ai' }, { sort: { createdAt: -1 } });

  if (aiMessage) {
    console.log('--- Latest AI Message ---');
    console.log(`Content: ${aiMessage.content}`);
    console.log(`Channel: ${aiMessage.channel}`);
    console.log(`Author Type: ${aiMessage.authorType}`);

    if (aiMessage.channel === 'widget') {
      console.log('\n✅ Channel is CORRECTLY set to WIDGET.');
      console.log(
        'Since the channel is WIDGET, it should NOT have triggered an email dispatch according to the new logic in ThreadsService.',
      );
    } else {
      console.log('\n❌ Channel is WRONG:', aiMessage.channel);
    }
  } else {
    console.log('AI Message NOT found');
  }

  await mongoose.disconnect();
}

verifyChannel().catch(console.error);
