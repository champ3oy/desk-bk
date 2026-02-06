import {
  OnModuleInit,
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { CustomersService } from '../customers/customers.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { MessageChannel } from '../threads/entities/message.entity';
import { convert } from 'html-to-text';

@Injectable()
export class WidgetGateway implements OnModuleInit {
  private wss: WebSocketServer;
  private readonly logger = new Logger(WidgetGateway.name);
  private rooms = new Map<string, Set<WebSocket>>();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    @Inject(forwardRef(() => CustomersService))
    private customersService: CustomersService,
    @Inject(forwardRef(() => IngestionService))
    private ingestionService: IngestionService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit() {
    // Attach WebSocket Server to the existing HTTP Server
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    // Do NOT pass server to start to avoid auto-listeners
    this.wss = new WebSocketServer({ noServer: true });

    this.logger.log('Native WebSocket Server initialized at /api/widget');

    // Manual Upgrade Handling
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/api/widget') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Setup heartbeat to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  onModuleDestroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.wss) this.wss.close();
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '', `http://${host}`);
    const channelId = url.searchParams.get('channelId');
    const sessionId = url.searchParams.get('sessionId');
    const name = url.searchParams.get('name') || '';
    const email = url.searchParams.get('email') || '';

    if (!channelId || !sessionId) {
      this.logger.warn(`Client connected without channelId or sessionId`);
      ws.close(1008, 'channelId and sessionId are required');
      return;
    }

    // Alive check logic
    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    const roomName = `${channelId}:${sessionId}`;

    // Join Room
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    this.rooms.get(roomName)?.add(ws);

    this.logger.log(`Widget Client connected: joined ${roomName}`);

    // Update customer info if provided
    if (name || email) {
      this.updateCustomerInfo(channelId, sessionId, name, email);
    }

    ws.on('message', async (message: Buffer) => {
      try {
        const rawData = message.toString();
        const parsed = JSON.parse(rawData);

        // Protocol: { event: 'message', data: { ... } }
        if (parsed.event === 'message' && parsed.data) {
          await this.handleMessage(
            ws,
            channelId,
            sessionId,
            name,
            email,
            parsed.data,
          );
        } else {
          this.logger.debug(`Received unknown event or format: ${rawData}`);
        }
      } catch (e) {
        this.logger.error(`Failed to parse WS message: ${e.message}`);
      }
    });

    ws.on('close', () => {
      this.logger.log(`Widget Client disconnected`);
      if (this.rooms.has(roomName)) {
        const room = this.rooms.get(roomName);
        if (room) {
          room.delete(ws);
          if (room.size === 0) {
            this.rooms.delete(roomName);
          }
        }
      }
    });

    ws.on('error', (err) => {
      this.logger.error(`WS Error: ${err.message}`);
    });
  }

  private async updateCustomerInfo(
    channelId: string,
    sessionId: string,
    name: string,
    email: string,
  ) {
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

  private async handleMessage(
    ws: WebSocket,
    channelId: string,
    sessionId: string,
    name: string,
    email: string,
    payload: { content: string; attachments?: any[]; tempId?: string },
  ) {
    if (!payload.content) return;

    this.logger.debug(
      `Received WS message from ${sessionId}: ${payload.content}`,
    );

    const ingestionPayload = {
      content: payload.content,
      sessionId: sessionId,
      name: name,
      email: email,
      attachments: payload.attachments || [],
    };

    try {
      const result = await this.ingestionService.ingestWithOrganization(
        ingestionPayload,
        'widget',
        MessageChannel.WIDGET,
        channelId,
      );

      // Send Acknowledgement
      const ack = JSON.stringify({
        event: 'messageAck',
        data: {
          tempId: payload.tempId,
          id: result.messageId,
          success: result.success,
        },
      });
      ws.send(ack);
    } catch (error) {
      this.logger.error(`WS Message processing failed: ${error.message}`);
      ws.send(
        JSON.stringify({
          event: 'error',
          data: { message: 'Failed to send message' },
        }),
      );
    }
  }

  /**
   * Send a new message to the connected widget client
   */
  sendNewMessage(channelId: string, sessionId: string, message: any) {
    const roomName = `${channelId}:${sessionId}`;
    const room = this.rooms.get(roomName);

    if (room && room.size > 0) {
      // Format message for the client
      const clientMessage = {
        id: message._id.toString(),
        text: convert(message.content, { wordwrap: false }),
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

      const payload = JSON.stringify({
        event: 'message',
        data: clientMessage,
      });

      room.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
      this.logger.debug(`Emitted raw WS message to ${roomName}`);
    }
  }
}
