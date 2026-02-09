import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      message:
        exception instanceof HttpException
          ? exception.getResponse()
          : 'Internal server error',
    };

    // Log the error with stack trace and context
    this.logger.error({
      message: `Exception thrown: ${httpAdapter.getRequestUrl(ctx.getRequest())}`,
      exception: exception instanceof Error ? exception.message : exception,
      stack: exception instanceof Error ? exception.stack : null,
      statusCode: httpStatus,
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
      method: httpAdapter.getRequestMethod(ctx.getRequest()),
      body: ctx.getRequest().body, // Careful with sensitive data here too, maybe sanitize?
    });

    httpAdapter.reply(ctx.getResponse(), responseBody, httpStatus);
  }
}
