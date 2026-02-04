import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

// ---------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------
const String orgId = '69724acec84f3520beda873c';
const String sessionId = 'flutter_user_123';
const String wsUrl = 'ws://localhost:3000/widget'; // Use 10.0.2.2 for Android Emulator

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Morpheus Chat',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: const ChatScreen(),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  late WebSocketChannel _channel;
  final List<Message> _messages = [];

  @override
  void initState() {
    super.initState();
    _connectWebSocket();
  }

  void _connectWebSocket() {
    // Construct URL with query parameters
    final uri = Uri.parse(wsUrl).replace(queryParameters: {
      'channelId': orgId,
      'sessionId': sessionId,
      'name': 'Flutter User',
      'email': 'flutter@test.com',
    });

    _channel = WebSocketChannel.connect(uri);

    // Listen to incoming stream
    _channel.stream.listen(
      (message) {
        _handleIncomingMessage(message);
      },
      onError: (error) => debugPrint('WS Error: $error'),
      onDone: () => debugPrint('WS Disconnected'),
    );
  }

  void _handleIncomingMessage(dynamic message) {
    try {
      final decoded = jsonDecode(message);
      final event = decoded['event'];
      final data = decoded['data'];

      if (event == 'message') {
        setState(() {
          _messages.insert(
            0,
            Message(
              text: data['text'] ?? '',
              isUser: data['sender'] == 'user',
              timestamp: DateTime.fromMillisecondsSinceEpoch(data['timestamp']),
            ),
          );
        });
      } else if (event == 'messageAck') {
        debugPrint('Message sent confirmed: ${data['tempId']}');
      }
    } catch (e) {
      debugPrint('Error parsing message: $e');
    }
  }

  void _sendMessage() {
    if (_controller.text.isEmpty) return;

    final content = _controller.text;
    final tempId = DateTime.now().millisecondsSinceEpoch.toString();

    // 1. Optimistic Update (Show immediately)
    setState(() {
      _messages.insert(
        0,
        Message(text: content, isUser: true, timestamp: DateTime.now()),
      );
    });

    // 2. Send to WebSocket
    final payload = jsonEncode({
      'event': 'message',
      'data': {
        'content': content,
        'tempId': tempId,
        'attachments': [],
      }
    });

    _channel.sink.add(payload);
    _controller.clear();
  }

  @override
  void dispose() {
    _channel.sink.close(status.goingAway);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Support Chat')),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              reverse: true,
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                return Align(
                  alignment:
                      msg.isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin:
                        const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: msg.isUser ? Colors.blue : Colors.grey[300],
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      msg.text,
                      style: TextStyle(
                        color: msg.isUser ? Colors.white : Colors.black,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: const InputDecoration(
                      hintText: 'Type a message...',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: _sendMessage,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class Message {
  final String text;
  final bool isUser;
  final DateTime timestamp;

  Message(
      {required this.text, required this.isUser, required this.timestamp});
}
