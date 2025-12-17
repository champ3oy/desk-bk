import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all active sessions for current user' })
  async findAll(@Request() req) {
    const sessions = await this.sessionsService.findAll(req.user.id);
    // Mark current session
    // We need to know which session ID corresponds to the current token.
    // For now, if we don't have session ID in token, we might guess by IP/UserAgent or just not mark it.
    // Ideally we add sessionId to JWT payload.
    const currentSessionId = req.user.sessionId; // Assuming we add this to JWT

    return sessions.map((session) => ({
      ...session.toObject(),
      isCurrent: currentSessionId
        ? session._id.toString() === currentSessionId
        : false,
    }));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a session' })
  remove(@Request() req, @Param('id') id: string) {
    return this.sessionsService.revoke(id, req.user.id);
  }
}
