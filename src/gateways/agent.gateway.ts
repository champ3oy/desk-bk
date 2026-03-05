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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../organizations/organizations.service';
import { KnowledgeBaseService } from '../ai/knowledge-base.service';
import { CustomersService } from '../customers/customers.service';
import { TicketsService } from '../tickets/tickets.service';
import { ThreadsService } from '../threads/threads.service';
import { playgroundChat } from '../ai/agents/playground';

@Injectable()
export class AgentGateway implements OnModuleInit {
  private wss: WebSocketServer;
  private readonly logger = new Logger(AgentGateway.name);
  private rooms = new Map<string, Set<WebSocket>>();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private readonly jwtService: JwtService,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly configService: ConfigService,
    private readonly organizationsService: OrganizationsService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    @Inject(forwardRef(() => ThreadsService))
    private readonly threadsService: ThreadsService,
  ) {}

  onModuleInit() {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    this.logger.log('Native Agent WebSocket Server initialized at /api/agent');

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/api/agent') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '', `http://${host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      this.logger.warn(`Agent connected without token`);
      ws.close(1008, 'Authentication token required');
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const organizationId = payload.organizationId;
      const userId = payload.sub;

      if (!organizationId) {
        throw new Error('Organization context missing in token');
      }

      (ws as any).isAlive = true;
      (ws as any).organizationId = organizationId;
      (ws as any).userId = userId;

      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      // Join Org Room
      this.joinRoom(ws, `org:${organizationId}`);
      this.logger.log(
        `Agent connected: User ${userId} in Org ${organizationId}`,
      );

      ws.on('message', (rawData: any) => {
        try {
          const message = rawData.toString();
          const parsed = JSON.parse(message);
          this.logger.debug(
            `Received event from user ${userId}: ${parsed.event}`,
          );

          if (parsed.event === 'join_ticket' && parsed.ticketId) {
            this.joinRoom(ws, `ticket:${parsed.ticketId}`);
            this.logger.log(
              `User ${userId} joined ticket room: ${parsed.ticketId}`,
            );
          }
          if (parsed.event === 'leave_ticket' && parsed.ticketId) {
            this.leaveRoom(ws, `ticket:${parsed.ticketId}`);
          }
          if (parsed.event === 'playground_chat' && parsed.data) {
            this.handlePlaygroundChat(ws, parsed.data, userId, organizationId);
          }
        } catch (e) {
          this.logger.warn(
            `Failed to parse WS message from user ${userId}: ${e.message}`,
          );
        }
      });

      ws.on('close', () => {
        this.rooms.forEach((clients, roomName) => {
          if (clients.has(ws)) {
            this.logger.debug(
              `Removing socket from room ${roomName} on disconnect`,
            );
            clients.delete(ws);
            if (clients.size === 0) {
              this.rooms.delete(roomName);
            }
          }
        });
        this.logger.log(`Agent disconnected: User ${userId}`);
      });
    } catch (e) {
      this.logger.error(`Authentication failed for agent WS: ${e.message}`);
      ws.close(1008, 'Invalid authentication');
    }
  }

  private async handlePlaygroundChat(
    ws: WebSocket,
    data: any,
    userId: string,
    organizationId: string,
  ) {
    const { message, history, provider, model, customerEmail, role } = data;

    try {
      this.logger.log(`[PlaygroundWS] Chat attempt for org ${organizationId}`);
      ws.send(JSON.stringify({ event: 'playground_chat_started', data: {} }));

      const response = await playgroundChat(
        message,
        this.configService,
        this.organizationsService,
        this.knowledgeBaseService,
        this.customersService,
        this.ticketsService,
        this.threadsService,
        organizationId,
        history,
        provider,
        model,
        customerEmail,
        userId,
        role || 'admin',
      );

      ws.send(
        JSON.stringify({ event: 'playground_chat_response', data: response }),
      );
    } catch (e) {
      this.logger.error(`Playground chat error: ${e.message}`);
      ws.send(
        JSON.stringify({
          event: 'playground_chat_error',
          data: { message: e.message },
        }),
      );
    }
  }

  private joinRoom(ws: WebSocket, roomName: string) {
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    this.rooms.get(roomName)?.add(ws);
    this.logger.debug(`Socket joined room: ${roomName}`);
  }

  private leaveRoom(ws: WebSocket, roomName: string) {
    const room = this.rooms.get(roomName);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(roomName);
      }
      this.logger.debug(`Socket left room: ${roomName}`);
    }
  }

  emitToOrg(organizationId: string, event: string, data: any) {
    this.emitToRoom(`org:${organizationId}`, event, data);
  }

  emitToTicket(ticketId: string, event: string, data: any) {
    this.emitToRoom(`ticket:${ticketId}`, event, data);
  }

  private emitToRoom(roomName: string, event: string, data: any) {
    const clients = this.rooms.get(roomName);
    if (clients) {
      const payload = JSON.stringify({ event, data });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
      this.logger.debug(`Emitted event ${event} to room ${roomName}`);
    }
  }
}
