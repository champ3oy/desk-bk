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
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, UserResponseDto } from '../users/entities/user.entity';
import { Invitation } from './entities/invitation.entity';

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create an invitation (Admin only)',
    description:
      'Send an invitation to join the organization. The invitee will receive a token to accept the invitation.',
  })
  @ApiBody({ type: CreateInvitationDto })
  @ApiCreatedResponse({
    description: 'Invitation successfully created',
    type: Invitation,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @ApiResponse({
    status: 409,
    description: 'User already exists or pending invitation exists',
  })
  create(@Body() createInvitationDto: CreateInvitationDto, @Request() req) {
    return this.invitationsService.create(
      createInvitationDto,
      req.user.organizationId,
      req.user.userId,
    );
  }

  @Post('accept')
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Accept an invitation by providing the token and setting a password. No authentication required.',
  })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted and user account created',
    schema: {
      type: 'object',
      properties: {
        user: { $ref: '#/components/schemas/UserResponseDto' },
        invitation: { $ref: '#/components/schemas/Invitation' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid token, expired, or already used',
  })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  accept(@Body() acceptInvitationDto: AcceptInvitationDto) {
    return this.invitationsService.accept(acceptInvitationDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get all invitations for the organization (Admin/Agent only)',
  })
  @ApiResponse({ status: 200, description: 'List of invitations', type: [Invitation] })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findAll(@Request() req) {
    return this.invitationsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get an invitation by ID (Admin/Agent only)',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID' })
  @ApiResponse({ status: 200, description: 'Invitation details', type: Invitation })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.invitationsService.findOne(id, req.user.organizationId);
  }

  @Patch(':id/resend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Resend an invitation (Admin only)',
    description:
      'Generates a new token and extends expiration for a pending invitation',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID' })
  @ApiResponse({
    status: 200,
    description: 'Invitation resent with new token',
    type: Invitation,
  })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiBadRequestResponse({
    description: 'Can only resend pending invitations',
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  resend(@Param('id') id: string, @Request() req) {
    return this.invitationsService.resend(id, req.user.organizationId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cancel an invitation (Admin only)',
    description: 'Cancels a pending invitation',
  })
  @ApiParam({ name: 'id', description: 'Invitation ID' })
  @ApiResponse({ status: 200, description: 'Invitation cancelled' })
  @ApiNotFoundResponse({ description: 'Invitation not found' })
  @ApiBadRequestResponse({
    description: 'Can only cancel pending invitations',
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  cancel(@Param('id') id: string, @Request() req) {
    return this.invitationsService.cancel(id, req.user.organizationId);
  }
}

