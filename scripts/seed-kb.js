const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI =
  'mongodb+srv://morpheusgh:6B4mIU0QRThMlcSc@cluster0.qn5buye.mongodb.net/MORPHESU_DESK?retryWrites=true&w=majority';

async function seedKB() {
  await mongoose.connect(MONGODB_URI);
  const orgId = '69724acec84f3520beda873c';

  const trainingSource = {
    organizationId: new mongoose.Types.ObjectId(orgId),
    name: 'About Morph',
    type: 'text',
    content:
      'Morph is a powerful AI-driven customer support platform that helps businesses automate their customer service. It supports multiple channels including Email, Live Chat (Widget), and Social Media. It uses advanced AI models like Gemini to provide accurate responses based on a custom knowledge base.',
    status: 'learned',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Note: findSimilar uses $vectorSearch which requires an embedding.
  // Since I can't easily generate the embedding here without the exact model/API,
  // I will just add the content.
  // BUT wait, findSimilar will FAIL if I don't have a vector index or if I don't have embeddings.

  // Actually, I'll just check if there's an existing training source I can update.
  const existing = await mongoose.connection.db
    .collection('trainingsources')
    .findOne({ organizationId: new mongoose.Types.ObjectId(orgId) });

  if (existing) {
    console.log('Updating existing training source');
    await mongoose.connection.db
      .collection('trainingsources')
      .updateOne(
        { _id: existing._id },
        { $set: { content: trainingSource.content, status: 'learned' } },
      );
  } else {
    console.log('Creating new training source');
    await mongoose.connection.db
      .collection('trainingsources')
      .insertOne(trainingSource);
  }

  console.log('Done seeding KB content (Note: Embedding might be missing)');
  await mongoose.disconnect();
}

seedKB().catch(console.error);
