const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const URL = 'ws://localhost:3000/widget';
const CHANNEL_ID = '69724acec84f3520beda873c';
const SESSION_ID = 'native_ws_tester';

const connectionUrl = `${URL}?channelId=${CHANNEL_ID}&sessionId=${SESSION_ID}&name=NativeTester&email=native@test.com`;

console.log('🔌 Connecting to:', connectionUrl);

const ws = new WebSocket(connectionUrl);

ws.on('open', () => {
  console.log('✅ Connected!');

  const message = {
    event: 'message',
    data: {
      content: 'Hello from Native WS ' + new Date().toLocaleTimeString(),
      tempId: uuidv4(),
    },
  };

  console.log('📤 Sending:', JSON.stringify(message, null, 2));
  ws.send(JSON.stringify(message));
});

ws.on('message', (data) => {
  const raw = data.toString();
  console.log('📩 Received:', raw);

  try {
    const parsed = JSON.parse(raw);
    if (parsed.event === 'messageAck') {
      console.log('🏁 Server Acknowledged:', parsed.data);
    }
  } catch (e) {}
});

ws.on('close', (code, reason) => {
  console.log(`❌ Disconnected: Code ${code} - ${reason}`);
});

ws.on('error', (err) => {
  console.error('⚠️ Error:', err.message);
});
