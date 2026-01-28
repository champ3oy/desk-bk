const fs = require('fs');
const https = require('https');
const path = require('path');

// Simple .env parser to get key
let apiKey = '';
try {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/GEMINI_API_KEY=(.+)/);
  if (match) apiKey = match[1].trim();
} catch (e) {
  // Try development env
  try {
    const envPath = path.join(__dirname, '.env.development');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) apiKey = match[1].trim();
  } catch (e2) {
    console.log('Could not read .env or .env.development');
  }
}

if (!apiKey) {
  console.error('API Key not found in .env files');
  process.exit(1);
}

console.log('Using API Key ending in:', apiKey.slice(-4));

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https
  .get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.error) {
          console.error('API Error:', json.error);
          return;
        }

        console.log('\n=== Embedding Models ===');
        const embeddings = (json.models || []).filter((m) =>
          m.name.toLowerCase().includes('embedding'),
        );
        embeddings.forEach((m) => {
          console.log(`Name: ${m.name}`);
          console.log(
            `Supported Methods: ${m.supportedGenerationMethods ? m.supportedGenerationMethods.join(', ') : 'unknown'}`,
          );
          console.log('---');
        });

        console.log('\n=== All Models ===');
        (json.models || []).forEach((m) => {
          console.log(`Name: ${m.name}`);
          console.log(`Methods: ${m.supportedGenerationMethods?.join(', ')}`);
        });
      } catch (e) {
        console.error('Parse Error:', e);
        console.log('Raw Data:', data);
      }
    });
  })
  .on('error', (e) => {
    console.error('Request Error:', e);
  });
