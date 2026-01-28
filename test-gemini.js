const WebSocket = require('ws');

const apiKey = 'AIzaSyB5HPgSXUiQveyrWaOmc-1x8du2DBWexDE'; // From your .env
const host = 'generativelanguage.googleapis.com';
const uri = `wss://${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

console.log('Connecting to:', uri);
const ws = new WebSocket(uri);

ws.on('open', () => {
  console.log('Connected!');

  const setupMsg = {
    setup: {
      model: 'models/gemini-2.5-flash-native-audio-latest',
      systemInstruction: {
        parts: [{ text: 'You are a helpful AI assistant.' }],
      },
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Charon',
            },
          },
        },
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'search_knowledge_base',
              description: 'Answer user questions.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  query: {
                    type: 'STRING',
                    description: 'Search query',
                  },
                },
                required: ['query'],
              },
            },
          ],
        },
      ],
    },
  };

  console.log('Sending setup...');
  ws.send(JSON.stringify(setupMsg));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('close', (code, reason) => {
  console.log(`Closed: ${code} ${reason}`);
});

ws.on('error', (err) => {
  console.error('Error:', err);
});
