import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { TicketsService } from '../../tickets/tickets.service';
import { ThreadsService } from '../../threads/threads.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Ticket } from '../../tickets/entities/ticket.entity';
import { CreateTicketDto } from '../../tickets/dto/create-ticket.dto';
import { UserRole } from '../../users/entities/user.entity';
import { TicketPaginationDto } from '../../tickets/dto/ticket-pagination.dto';
import { Message } from '../../threads/entities/message.entity';
import { CreateMessageDto } from '../../threads/dto/create-message.dto';
import { MessageType } from '../../threads/entities/message.entity';

@ApiTags('Mobile API - Customer Tickets')
@ApiBearerAuth('JWT-auth')
@Controller('api/mobile/tickets')
@UseGuards(JwtAuthGuard)
export class CustomerTicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly threadsService: ThreadsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List my tickets' })
  @ApiResponse({ status: 200, description: 'List of tickets', type: [Ticket] })
  async findAll(@Request() req, @Query() paginationDto: TicketPaginationDto) {
    // Enforce Customer Role check if needed, or just rely on service filtering by userId
    if (req.user.role !== UserRole.CUSTOMER) {
      // Optionally enforce stricter role checks, but for now we assume any valid user can be a 'customer' in this context
      // or we explicitly forbid agents from using this specific API?
      // Actually, typically agents might use the mobile app too, but this API is scoped for "My Tickets" view.
    }

    return this.ticketsService.findAll(
      req.user.userId,
      req.user.role,
      req.user.organizationId,
      paginationDto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket details' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({ status: 200, description: 'Ticket details', type: Ticket })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.ticketsService.findOne(
      id,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new ticket' })
  @ApiBody({ type: CreateTicketDto })
  @ApiResponse({ status: 201, description: 'Ticket created', type: Ticket })
  async create(@Body() createTicketDto: CreateTicketDto, @Request() req) {
    // Force customerId to be the authenticated user
    createTicketDto.customerId = req.user.userId;

    return this.ticketsService.create(createTicketDto, req.user.organizationId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({
    status: 200,
    description: 'List of messages',
    type: [Message],
  })
  async getMessages(@Param('id') id: string, @Request() req) {
    // 1. Verify access to ticket
    await this.ticketsService.findOne(
      id,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );

    // 2. Find thread
    const thread = await this.threadsService.findByTicket(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );

    if (!thread) {
      throw new NotFoundException('Thread not found for this ticket');
    }

    // 3. Get messages
    return this.threadsService.getMessages(
      thread._id.toString(),
      req.user.organizationId,
      req.user.userId,
      req.user.role,
      // For customers, we might want to ensure they only see EXTERNAL messages?
      // ThreadsService.getMessages logic handles this slightly, but let's be explicit if needed.
      // logic in ThreadsService.getMessages: "For customers, only show external messages" (line 503)
      undefined, // let service handle filtering
    );
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiBody({
    schema: { type: 'object', properties: { content: { type: 'string' } } },
  })
  @ApiResponse({ status: 201, description: 'Message created', type: Message })
  async reply(
    @Param('id') id: string,
    @Body('content') content: string,
    @Request() req,
  ) {
    if (!content) {
      throw new NotFoundException('Content is required');
    }

    // 1. Find thread
    const thread = await this.threadsService.findByTicket(
      id,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    // 2. Create message
    const messageDto = new CreateMessageDto();
    messageDto.content = content;
    messageDto.messageType = MessageType.EXTERNAL;
    messageDto.channel = req.body.channel || 'platform'; // Allow channel override or default

    return this.threadsService.createMessage(
      thread._id.toString(),
      messageDto,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }
}
