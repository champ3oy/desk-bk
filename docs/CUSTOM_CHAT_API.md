# Custom Chat Widget API Documentation

This documentation outlines how to integrate a custom chat interface with the Morpheus Desk. This allows you to build your own UI while leveraging our ticketing and AI capabilities.

## Base URL

All requests should be made to your Morpheus Desk backend API URL:
`https://api.morpheusdesk.com/webhooks`

## Authentication

Authentication is handled via your **Organization ID**. You must include this ID in every request, either as a header or a parameter.

- **Header**: `x-channel-id: <YOUR_ORG_ID>`
- **Query/Body Parameter**: `channelId`

---

## 1. Send a Message

Send a message from a user to the helpdesk. If the user doesn't exist, they will be automatically created using the provided name and email.

**Endpoint:** `POST /widget`

### Headers

| Header         | Value              |
| -------------- | ------------------ |
| `Content-Type` | `application/json` |
| `x-channel-id` | `<YOUR_ORG_ID>`    |

### Body Parameters

| Parameter     | Type   | Required | Description                                                                                                                  |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `content`     | string | Yes      | The message text to send.                                                                                                    |
| `sessionId`   | string | Yes      | A unique, stable ID for the user (e.g., your app's User ID). This ensures chat history is preserved across devices/sessions. |
| `name`        | string | No       | The logged-in user's full name.                                                                                              |
| `email`       | string | No       | The logged-in user's email address. Used to link the chat to a Customer profile.                                             |
| `attachments` | array  | No       | Array of file attachment objects (if supported).                                                                             |

### Example Request

```json
// POST /webhooks/widget
{
  "content": "Hi, I'm having trouble with my subscription.",
  "sessionId": "user_id_550e8400",
  "name": "Sarah Connor",
  "email": "sarah@example.com"
}
```

### Response

```json
{
  "success": true,
  "ticketId": "65b2...",
  "messageId": "65b2..."
}
```

---

## 2. Get Chat History

Retrieve the conversation history for a specific user session.

**Endpoint:** `GET /widget/history`

### Query Parameters

| Parameter   | Required | Description                                      |
| ----------- | -------- | ------------------------------------------------ |
| `channelId` | Yes      | Your Organization ID.                            |
| `sessionId` | Yes      | The unique session/user ID to fetch history for. |

### Example Request

`GET /webhooks/widget/history?channelId=org_123&sessionId=user_id_550e8400`

### Response

```json
{
  "messages": [
    {
      "id": "msg_101",
      "text": "Hi, I'm having trouble with my subscription.",
      "sender": "user",
      "timestamp": 1706798000000
    },
    {
      "id": "msg_102",
      "text": "Hello Sarah! I can help with that. What seems to be the issue?",
      "sender": "agent",
      "authorName": "Support Team",
      "timestamp": 1706798050000
    }
  ]
}
```

---

## 3. Get Widget Configuration (Optional)

Retrieve the configured branding and settings for your organization (e.g., colors, welcome message). Use this if you want your custom UI to match the settings defined in the Morpheus dashboard.

**Endpoint:** `GET /widget/config`

### Query Parameters

| Parameter   | Required | Description           |
| ----------- | -------- | --------------------- |
| `channelId` | Yes      | Your Organization ID. |

### Example Request

`GET /webhooks/widget/config?channelId=org_123`

### Response

```json
{
  "primaryColor": "#06B6D4",
  "secondaryColor": "#0F2035",
  "welcomeMessage": "Hello! How can we help you today?",
  "position": "bottom-right"
}
```

---

## 4. Real-time Updates (WebSocket)

Instead of polling `GET /history`, you can connect via WebSocket to receive messages in real-time.

**Connection URL:** `https://api.morpheusdesk.com/widget`
**Protocol:** Socket.IO v4

### Connection Options

You must pass `channelId` and `sessionId` in the query parameters. You can voluntarily pass `name` and `email` to identify the user immediately upon connection.

```javascript
import { io } from 'socket.io-client';

const socket = io('https://api.morpheusdesk.com/widget', {
  query: {
    channelId: 'YOUR_ORG_ID',
    sessionId: 'user_session_abc123',
    name: 'John Doe', // Optional
    email: 'john@example.com', // Optional
  },
});

socket.on('connect', () => {
  console.log('Connected to chat');
});

socket.on('message', (message) => {
  console.log('New message received:', message);
  // message structure:
  // {
  //   id: "msg_123",
  //   text: "Hello...",
  //   sender: "agent",
  //   timestamp: 1700000000000
  // }
});
```

### Sending Messages

You can also send messages directly via the socket instead of using the REST API.

```javascript
// Send a message
socket.emit('message', {
  content: 'Hello, I need help!',
  attachments: [], // Optional
});

// Listen for acknowledgement (optional)
socket.on('messageAck', (ack) => {
  console.log('Message sent successfully:', ack);
});
```
