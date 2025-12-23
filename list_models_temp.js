import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('No API Key found');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    const models = await genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      .apiKey;
    // Actually the SDK doesn't have a direct listModels on the client instance easily accessible in this version?
    // Let's use fetch directly to be sure.
  } catch (e) {
    console.log(e);
  }
}

// Easier to use curl
console.log('Use curl instead');
