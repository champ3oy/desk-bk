const mongoose = require('mongoose');

async function checkOrgs() {
  const uri =
    'mongodb+srv://deadalus:Samarithan2293%40@cluster0.nwde7lt.mongodb.net/MORPH_DESK?retryWrites=true&w=majority';
  await mongoose.connect(uri);

  const userSchema = new mongoose.Schema({}, { strict: false });
  const User = mongoose.model('User', userSchema);

  const orgSchema = new mongoose.Schema({}, { strict: false });
  const Organization = mongoose.model('Organization', orgSchema);

  const email = process.argv[2];
  if (!email) {
    console.error('Please provide an email');
    process.exit(1);
  }

  console.log(`Checking organizations for email: ${email}`);

  const users = await User.find({
    email: { $regex: new RegExp('^' + email + '$', 'i') },
  });
  console.log(`Found ${users.length} user records:`);
  users.forEach((u) => {
    console.log(` - ID: ${u._id}, OrgID: ${u.organizationId}, Role: ${u.role}`);
  });

  const orgIds = users
    .filter((u) => u.organizationId)
    .map((u) => u.organizationId);
  const orgs = await Organization.find({ _id: { $in: orgIds } });

  console.log(`\nAll organizations in DB:`);
  const allOrgs = await Organization.find({});
  allOrgs.forEach((o) => {
    console.log(` - ID: ${o._id}, Name: ${o.name}`);
  });

  process.exit(0);
}

checkOrgs().catch((err) => {
  console.error(err);
  process.exit(1);
});
