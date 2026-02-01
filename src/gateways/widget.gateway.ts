import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { MessageChannel } from '../threads/entities/message.entity';

@WebSocketGateway({
  namespace: 'widget',
  cors: {
    origin: '*', // Allow all origins for the widget
  },
})
export class WidgetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WidgetGateway.name);

  constructor(
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    @Inject(forwardRef(() => IngestionService))
    private ingestionService: IngestionService,
  ) {}

  async handleConnection(client: Socket) {
    const query = client.handshake.query;
    const channelId = query.channelId as string;
    const sessionId = query.sessionId as string;
    const name = query.name as string;
    const email = query.email as string;

    if (!channelId || !sessionId) {
      this.logger.warn(
        `Client connected without channelId or sessionId: ${client.id}`,
      );
      client.disconnect();
      return;
    }

    const roomName = `${channelId}:${sessionId}`;
    client.join(roomName);
    this.logger.log(`Widget Client connected: ${client.id} joined ${roomName}`);

    // Update customer info if provided
    if (name || email) {
      try {
        await this.customersService.findOrCreate(
          {
            externalId: sessionId,
            email: email,
            firstName: name ? name.split(' ')[0] : undefined,
            lastName: name ? name.split(' ').slice(1).join(' ') : undefined,
          },
          channelId,
        );
        this.logger.log(`Updated customer info for session ${sessionId}`);
      } catch (error) {
        this.logger.error(
          `Failed to update customer info on WS connection: ${error.message}`,
        );
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Widget Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { content: string; attachments?: any[] },
  ) {
    const { channelId, sessionId, name, email } = client.handshake.query;

    if (!channelId || !sessionId || !payload.content) {
      return;
    }

    this.logger.debug(
      `Received WS message from ${sessionId}: ${payload.content}`,
    );

    // Call IngestionService to process the message
    // Mimic the payload structure expected by IngestionService
    const ingestionPayload = {
      content: payload.content,
      sessionId: sessionId as string,
      name: name as string,
      email: email as string,
      attachments: payload.attachments || [],
    };

    try {
      const result = await this.ingestionService.ingestWithOrganization(
        ingestionPayload,
        'widget',
        MessageChannel.WIDGET,
        channelId as string,
      );

      // Emit confirmation back to sender?
      // Standard practice: Echo back OR let the 'new message' event handle it (including sender's own msg)
      // Usually, sender optimistically adds to UI.
      // But if we want to confirm receipt:
      client.emit('messageAck', {
        tempId: payload['tempId'],
        id: result.messageId,
        success: result.success,
      });
    } catch (error) {
      this.logger.error(`WS Message processing failed: ${error.message}`);
      client.emit('error', { message: 'Failed to send message' });
    }
  }

  /**
   * Send a new message to the connected widget client
   */
  sendNewMessage(channelId: string, sessionId: string, message: any) {
    const roomName = `${channelId}:${sessionId}`;

    // Format message for the client
    const clientMessage = {
      id: message._id.toString(),
      text: message.content,
      sender: message.authorType === 'customer' ? 'user' : 'agent',
      authorType: message.authorType,
      authorName:
        message.authorId && (message.authorId as any).firstName
          ? `${(message.authorId as any).firstName} ${(message.authorId as any).lastName || ''}`.trim()
          : undefined,
      timestamp: message.createdAt
        ? new Date(message.createdAt).getTime()
        : Date.now(),
      attachments: message.attachments || [],
    };

    this.server.to(roomName).emit('message', clientMessage);
    this.logger.debug(`Emitted message to ${roomName}`);
  }
}
