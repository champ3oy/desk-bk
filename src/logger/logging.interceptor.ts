import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() === 'http') {
      const ctx = context.switchToHttp();
      const request = ctx.getRequest();
      const response = ctx.getResponse();
      const { method, url, body, query, params, ip } = request;
      const userAgent = request.get('user-agent') || '';
      const startTime = Date.now();

      return next.handle().pipe(
        tap((data) => {
          const duration = Date.now() - startTime;
          const { statusCode } = response;

          this.logger.log({
            message: `${method} ${url} ${statusCode} - ${duration}ms`,
            method,
            url,
            statusCode,
            duration,
            body: this.sanitize(body), // Sanitize sensitive data
            query,
            params,
            ip,
            userAgent,
            // Don't log full response body unless necessary, maybe just length or status
            responseLength: JSON.stringify(data)?.length,
          });
        }),
      );
    }
    return next.handle();
  }

  private sanitize(body: any): any {
    if (!body) return body;
    const sanitized = { ...body };
    if (sanitized.password) sanitized.password = '***';
    if (sanitized.token) sanitized.token = '***';
    if (sanitized.accessToken) sanitized.accessToken = '***';
    if (sanitized.refreshToken) sanitized.refreshToken = '***';
    return sanitized;
  }
}
