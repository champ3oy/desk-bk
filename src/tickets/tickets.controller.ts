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
  BadRequestException,
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
} from '@nestjs/swagger';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { MergeTicketDto } from './dto/merge-ticket.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Ticket } from './entities/ticket.entity';
import { ThreadsService } from '../threads/threads.service';
import { CreateMessageDto } from '../threads/dto/create-message.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import { Message } from '../threads/entities/message.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TicketPaginationDto } from './dto/ticket-pagination.dto';

@ApiTags('Tickets')
@ApiBearerAuth('JWT-auth')
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly threadsService: ThreadsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new ticket',
    description: 'Tickets are created for customers (external parties)',
  })
  @ApiBody({ type: CreateTicketDto })
  @ApiCreatedResponse({
    description: 'Ticket successfully created',
    type: Ticket,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createTicketDto: CreateTicketDto, @Request() req) {
    return this.ticketsService.create(createTicketDto, req.user.organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tickets (filtered by user role)' })
  @ApiResponse({ status: 200, description: 'List of tickets', type: [Ticket] })
  findAll(@Request() req, @Query() paginationDto: TicketPaginationDto) {
    return this.ticketsService.findAll(
      req.user.userId,
      req.user.role,
      req.user.organizationId,
      paginationDto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a ticket by ID' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({ status: 200, description: 'Ticket details', type: Ticket })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.ticketsService.findOne(
      id,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiBody({ type: UpdateTicketDto })
  @ApiResponse({
    status: 200,
    description: 'Ticket successfully updated',
    type: Ticket,
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @Request() req,
  ) {
    return this.ticketsService.update(
      id,
      updateTicketDto,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a ticket' })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiResponse({ status: 200, description: 'Ticket successfully deleted' })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  remove(@Param('id') id: string, @Request() req) {
    return this.ticketsService.remove(
      id,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }

  @Post(':id/messages')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({
    summary: 'Send a message to a ticket (Admin/Agent only)',
    description:
      "Sends a message to the ticket's thread. Each ticket has exactly one thread. " +
      'Specify messageType as "external" (visible to customer) or "internal" (not visible to customer).',
  })
  @ApiParam({ name: 'id', description: 'Ticket ID' })
  @ApiBody({ type: CreateTicketMessageDto })
  @ApiCreatedResponse({
    description: 'Message successfully sent',
    type: Message,
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  async sendMessage(
    @Param('id') id: string,
    @Body() createTicketMessageDto: CreateTicketMessageDto,
    @Request() req,
  ) {
    // Verify ticket access and get ticket details
    const ticket = await this.ticketsService.findOne(
      id,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );

    // Get or create the single thread for this ticket
    const thread = await this.threadsService.getOrCreateThread(
      id,
      ticket.customerId.toString(),
      req.user.organizationId,
    );

    // Create message DTO
    const createMessageDto: CreateMessageDto = {
      content: createTicketMessageDto.content,
      messageType: createTicketMessageDto.messageType,
      channel: createTicketMessageDto.channel,
    };

    // Send message to the thread
    return this.threadsService.createMessage(
      thread._id.toString(),
      createMessageDto,
      req.user.organizationId,
      req.user.userId,
      req.user.role,
    );
  }

  @Post(':id/merge')
  @ApiOperation({ summary: 'Merge this ticket into another ticket' })
  @ApiParam({ name: 'id', description: 'Source Ticket ID' })
  @ApiBody({ type: MergeTicketDto })
  @ApiResponse({
    status: 200,
    description: 'Ticket merged successfully',
    type: Ticket,
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  @ApiForbiddenResponse({ description: 'Access denied' })
  merge(
    @Param('id') id: string,
    @Body() mergeTicketDto: MergeTicketDto,
    @Request() req,
  ) {
    return this.ticketsService.merge(
      id,
      mergeTicketDto.targetTicketId,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }
}
