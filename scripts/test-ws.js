const { io } = require('socket.io-client');

// Configuration from your request
const URL = 'http://localhost:3005';
const NAMESPACE = '/widget';
const QUERY = {
  channelId: '69724acec84f3520beda873c',
  sessionId: 'postman_session_6',
  name: 'Postman',
  email: 'akotosel6+102@gmail.com',
};

console.log(`Connecting to ${URL}${NAMESPACE}...`);

const socket = io(`${URL}${NAMESPACE}`, {
  query: QUERY,
  transports: ['websocket'], // Force websocket for cleaner testing
});

socket.on('connect', () => {
  console.log('✅ Connected successfully!');
  console.log(`Socket ID: ${socket.id}`);

  // Send a test message
  const testMessage = {
    content: 'Hi there! I have a general question.',
    tempId: 'test-' + Date.now(),
  };

  console.log('📤 Sending message:', testMessage.content);
  socket.emit('message', testMessage);
});

socket.on('messageAck', (ack) => {
  console.log('📥 Received Message Ack:', ack);
});

socket.on('message', (message) => {
  console.log('\n📥 Received message via Socket:');
  console.log(
    `[${message.authorType}] ${message.sender || message.authorName || 'System'}: ${message.text}`,
  );

  if (message.authorType === 'ai') {
    console.log('\n✨ AI AUTO-RESPONSE WORKING! ✨');
    console.log('Result:', message.text);
    process.exit(0);
  } else if (message.authorType === 'customer') {
    console.log('(Echo of your own message)');
  }
});

socket.on('error', (err) => {
  console.error('❌ Socket error:', err);
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('⚠️ Disconnected:', reason);
});

// Timeout after 90 seconds if no AI response
setTimeout(() => {
  console.warn('\n⌛ Timeout: No AI response received within 90 seconds.');
  console.log(
    'Check if AI_AUTO_REPLY_LIVE_CHAT is enabled in organization settings.',
  );
  process.exit(1);
}, 90000);
