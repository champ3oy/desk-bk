import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ThreadsService } from './threads.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { Thread } from './entities/thread.entity';
import { MessageType } from './entities/message.entity';
import { Message } from './entities/message.entity';

@ApiTags('Threads')
@ApiBearerAuth('JWT-auth')
@Controller('threads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({
    summary: 'Create or get thread for a ticket (Admin/Agent only)',
    description:
      'Creates or returns the existing thread for a ticket. Each ticket has exactly one thread. ' +
      'Note: Threads are usually auto-created when tickets are created, so this endpoint is mainly for edge cases.',
  })
  @ApiBody({ type: CreateThreadDto })
  @ApiCreatedResponse({
    description: 'Thread successfully created or retrieved',
    type: Thread,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  create(@Body() createThreadDto: CreateThreadDto, @Request() req) {
    return this.threadsService.create(
      createThreadDto,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get('ticket/:ticketId')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get thread for a ticket (Admin/Agent/Light Agent)',
    description:
      'Get the single thread for a ticket. Each ticket has exactly one thread.',
  })
  @ApiParam({ name: 'ticketId', description: 'Ticket ID' })
  @ApiResponse({ status: 200, description: 'Thread details', type: Thread })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findByTicket(@Param('ticketId') ticketId: string, @Request() req: any) {
    return this.threadsService.findByTicket(
      ticketId,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get a thread by ID (Admin/Agent/Light Agent)',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'Thread details', type: Thread })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.threadsService.findOne(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Post(':id/messages')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Send a message in a thread (Admin/Agent/Light Agent)',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiBody({ type: CreateMessageDto })
  @ApiCreatedResponse({
    description: 'Message successfully sent',
    type: Message,
  })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  createMessage(
    @Param('id') id: string,
    @Body() createMessageDto: CreateMessageDto,
    @Request() req,
  ) {
    return this.threadsService.createMessage(
      id,
      createMessageDto,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get(':id/messages')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get all messages in a thread (Admin/Agent/Light Agent)',
    description:
      'Get messages in a thread. Optionally filter by message type (external/internal).',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiQuery({
    name: 'messageType',
    required: false,
    enum: MessageType,
    description: 'Filter by message type (external or internal)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of messages',
    type: [Message],
  })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  getMessages(
    @Param('id') id: string,
    @Request() req: any,
    @Query('messageType') messageType?: MessageType,
  ) {
    return this.threadsService.getMessages(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
      messageType,
    );
  }

  @Patch('messages/:messageId/read')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Mark a message as read (Admin/Agent/Light Agent)',
  })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiResponse({ status: 200, description: 'Message marked as read' })
  @ApiNotFoundResponse({ description: 'Message not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  markAsRead(@Param('messageId') messageId: string, @Request() req) {
    return this.threadsService.markAsRead(
      messageId,
      req.user.organizationId,
      req.user.userId,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a thread (Admin only)',
    description: 'Soft delete - marks thread as inactive',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'Thread successfully deleted' })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.threadsService.remove(id, req.user.organizationId);
  }

  @Post(':id/participants')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({
    summary: 'Add participants to a thread (Admin/Agent only)',
    description:
      'Add users or groups as participants to a thread. Participants can see internal messages.',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        participantUserIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of user IDs to add as participants',
        },
        participantGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of group IDs to add as participants',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Participants added', type: Thread })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  addParticipants(
    @Param('id') id: string,
    @Body()
    body: {
      participantUserIds?: string[];
      participantGroupIds?: string[];
    },
    @Request() req,
  ) {
    return this.threadsService.addParticipants(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
      body.participantUserIds,
      body.participantGroupIds,
    );
  }

  @Delete(':id/participants')
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({
    summary: 'Remove participants from a thread (Admin/Agent only)',
    description: 'Remove users or groups from thread participants.',
  })
  @ApiParam({ name: 'id', description: 'Thread ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        participantUserIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of user IDs to remove from participants',
        },
        participantGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of group IDs to remove from participants',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Participants removed',
    type: Thread,
  })
  @ApiNotFoundResponse({ description: 'Thread not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  removeParticipants(
    @Param('id') id: string,
    @Body()
    body: {
      participantUserIds?: string[];
      participantGroupIds?: string[];
    },
    @Request() req,
  ) {
    return this.threadsService.removeParticipants(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
      body.participantUserIds,
      body.participantGroupIds,
    );
  }
}
