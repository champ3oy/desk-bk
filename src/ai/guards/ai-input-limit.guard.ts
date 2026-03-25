import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Injectable()
export class AiInputLimitGuard implements CanActivate {
  private readonly logger = new Logger(AiInputLimitGuard.name);

  // Max input sizes
  private static readonly MAX_CONTEXT_LENGTH = 5000; // characters for additional context
  private static readonly MAX_TICKET_ID_LENGTH = 50;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const body = request.body;

    if (!body) return true;

    // Validate ticketId format
    if (body.ticketId && body.ticketId.length > AiInputLimitGuard.MAX_TICKET_ID_LENGTH) {
      throw new HttpException(
        'Invalid ticket ID format.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate context/description length
    if (body.context && body.context.length > AiInputLimitGuard.MAX_CONTEXT_LENGTH) {
      throw new HttpException(
        `Additional context must be under ${AiInputLimitGuard.MAX_CONTEXT_LENGTH} characters.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (body.description && body.description.length > AiInputLimitGuard.MAX_CONTEXT_LENGTH) {
      throw new HttpException(
        `Description must be under ${AiInputLimitGuard.MAX_CONTEXT_LENGTH} characters.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return true;
  }
}
