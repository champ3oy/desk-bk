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
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { RemoveMembersDto } from './dto/remove-members.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { Group } from './entities/group.entity';

@ApiTags('Groups')
@ApiBearerAuth('JWT-auth')
@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new group (Admin only)',
    description:
      'Tickets can be assigned to groups, making them visible to all group members',
  })
  @ApiBody({ type: CreateGroupDto })
  @ApiCreatedResponse({
    description: 'Group successfully created',
    type: Group,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @ApiResponse({
    status: 409,
    description: 'Group with this name already exists',
  })
  create(@Body() createGroupDto: CreateGroupDto, @Request() req) {
    return this.groupsService.create(createGroupDto, req.user.organizationId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get all groups in organization (Admin/Agent/Light Agent)',
  })
  @ApiResponse({ status: 200, description: 'List of groups', type: [Group] })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findAll(@Request() req) {
    return this.groupsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get a group by ID (Admin/Agent/Light Agent)',
  })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: 'Group details', type: Group })
  @ApiNotFoundResponse({ description: 'Group not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.groupsService.findOne(id, req.user.organizationId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a group (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiBody({ type: UpdateGroupDto })
  @ApiResponse({
    status: 200,
    description: 'Group successfully updated',
    type: Group,
  })
  @ApiNotFoundResponse({ description: 'Group not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @Request() req,
  ) {
    return this.groupsService.update(
      id,
      updateGroupDto,
      req.user.organizationId,
    );
  }

  @Post(':id/members')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Add members to a group (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiBody({ type: AddMembersDto })
  @ApiResponse({
    status: 200,
    description: 'Members successfully added to group',
    type: Group,
  })
  @ApiNotFoundResponse({ description: 'Group not found' })
  @ApiBadRequestResponse({
    description: 'Invalid member IDs or users are not agents/admins',
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  addMembers(
    @Param('id') id: string,
    @Body() addMembersDto: AddMembersDto,
    @Request() req,
  ) {
    return this.groupsService.addMembers(
      id,
      addMembersDto,
      req.user.organizationId,
    );
  }

  @Delete(':id/members')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Remove members from a group (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiBody({ type: RemoveMembersDto })
  @ApiResponse({
    status: 200,
    description: 'Members successfully removed from group',
    type: Group,
  })
  @ApiNotFoundResponse({ description: 'Group not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  removeMembers(
    @Param('id') id: string,
    @Body() removeMembersDto: RemoveMembersDto,
    @Request() req,
  ) {
    return this.groupsService.removeMembers(
      id,
      removeMembersDto,
      req.user.organizationId,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a group (Admin only)',
  })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: 'Group successfully deleted' })
  @ApiNotFoundResponse({ description: 'Group not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  remove(@Param('id') id: string, @Request() req) {
    return this.groupsService.remove(id, req.user.organizationId);
  }
}
