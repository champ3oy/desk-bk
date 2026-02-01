const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI =
  'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';

async function checkOrg() {
  await mongoose.connect(MONGODB_URI);
  const orgId = '69724acec84f3520beda873c';

  const org = await mongoose.connection.db
    .collection('organizations')
    .findOne({ _id: new mongoose.Types.ObjectId(orgId) });

  if (org) {
    console.log('Organization found:');
    console.log(`Name: ${org.name}`);
    console.log(`aiAutoReplyEmail: ${org.aiAutoReplyEmail}`);
    console.log(`aiAutoReplyLiveChat: ${org.aiAutoReplyLiveChat}`);
    console.log(`aiAutoReplySocialMedia: ${org.aiAutoReplySocialMedia}`);
  } else {
    console.log('Organization NOT found');
  }

  await mongoose.disconnect();
}

checkOrg().catch(console.error);
