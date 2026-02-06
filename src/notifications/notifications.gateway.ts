import {
  OnModuleInit,
  OnModuleDestroy,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class NotificationsGateway implements OnModuleInit, OnModuleDestroy {
  private wss: WebSocketServer;
  private readonly logger = new Logger(NotificationsGateway.name);
  private userConnections = new Map<string, Set<WebSocket>>();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jwtService: JwtService,
  ) {}

  onModuleInit() {
    const server = this.httpAdapterHost.httpAdapter.getHttpServer();
    // Do NOT pass server to WebSocketServer constructor to prevent auto-binding "upgrade"
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/api/notifications/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.logger.log(
      'Notifications WebSocket Server initialized at /api/notifications/ws',
    );

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Heartbeat
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

  private handleConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      this.logger.warn('WS Client tried to connect without token');
      ws.close(1008, 'Token required');
      return;
    }

    try {
      // Verify Token
      const payload = this.jwtService.verify(token);
      const userId = payload.sub || payload.userId || payload._id; // Adapt based on actual JWT payload

      if (!userId) {
        throw new Error('Invalid Token Payload');
      }

      // Alive check
      (ws as any).isAlive = true;
      (ws as any).userId = userId;
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      this.logger.debug(
        `WS Auth Success for user: ${userId}. Token sub: ${payload.sub}`,
      );

      // Add to connections
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)?.add(ws);

      this.logger.log(`User ${userId} connected to notifications WS`);

      ws.on('close', () => {
        const connections = this.userConnections.get(userId);
        if (connections) {
          connections.delete(ws);
          if (connections.size === 0) {
            this.userConnections.delete(userId);
          }
        }
      });
    } catch (e) {
      this.logger.error(`WS Auth Failed: ${e.message}`);
      ws.close(1008, 'Authentication Failed');
    }
  }

  sendToUser(userId: string, event: string, data: any) {
    const connections = this.userConnections.get(userId);
    this.logger.debug(
      `Attempting to send '${event}' to user ${userId}. Active connections: ${connections?.size || 0}`,
    );

    if (connections && connections.size > 0) {
      const payload = JSON.stringify({ event, data });
      let sentCount = 0;
      connections.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
          sentCount++;
        }
      });
      this.logger.log(
        `Sent '${event}' to user ${userId} (${sentCount}/${connections.size} clients)`,
      );
    } else {
      this.logger.warn(`No active WS connections for user ${userId}`);
    }
  }
}
