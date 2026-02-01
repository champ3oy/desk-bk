const io = require('socket.io-client');

console.log('🚀 Connecting to Widget WebSocket...');

const socket = io('http://localhost:3005/widget', {
  transports: ['websocket'],
  query: {
    channelId: '69724acec84f3520beda873c',
    sessionId: 'postman_session_2',
    name: 'Postman',
    email: 'postman@example.com',
  },
});

socket.on('connect', () => {
  console.log('✅ Connected! Socket ID:', socket.id);

  const payload = {
    content: 'Testing from script at ' + new Date().toLocaleTimeString(),
  };

  console.log('📤 Sending message:', payload);
  socket.emit('message', payload);
});

socket.on('message', (msg) => {
  console.log('📩 Received message:', JSON.stringify(msg, null, 2));
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection Error:', err.message);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});
