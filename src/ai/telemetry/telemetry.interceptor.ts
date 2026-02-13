import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { telemetryStorage } from './telemetry.context';

@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Determine the feature based on the request path
    const path = request.path;
    let feature = 'api-call';

    if (path.includes('draft-response')) feature = 'draft-response';
    else if (path.includes('analyze-sentiment')) feature = 'sentiment';
    else if (path.includes('summarize-ticket')) feature = 'summary';
    else if (path.includes('playground-chat')) feature = 'playground';
    else if (path.includes('generate-instructions')) feature = 'instructions';

    // Extract ticket ID from body if present
    const ticketId = request.body?.ticketId;

    const telemetryContext = {
      organizationId: user?.organizationId?.toString(),
      userId: user?.userId?.toString() || user?.id?.toString(),
      ticketId,
      feature,
    };

    // Wrap the request handler in the telemetry storage context
    return new Observable((subscriber) => {
      telemetryStorage.run(telemetryContext, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
