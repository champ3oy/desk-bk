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
} from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { Organization } from './entities/organization.entity';

@ApiTags('Organizations')
@ApiBearerAuth('JWT-auth')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a new organization (user becomes admin of the organization)',
  })
  @ApiBody({ type: CreateOrganizationDto })
  @ApiCreatedResponse({
    description: 'Organization successfully created and user assigned as admin',
    type: Organization,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  create(@Body() createOrganizationDto: CreateOrganizationDto, @Request() req) {
    return this.organizationsService.create(
      createOrganizationDto,
      req.user.userId,
    );
  }

  @Get('mine')
  @ApiOperation({ summary: 'Get organizations for the current user' })
  @ApiResponse({
    status: 200,
    description: 'List of organizations',
    type: [Organization],
  })
  findMine(@Request() req) {
    console.log(
      `OrganizationsController.findMine: Finding orgs for user email=${req.user.email}`,
    );
    return this.organizationsService.findByMemberEmail(req.user.email);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({ summary: 'Get all organizations (Admin/Agent/Light Agent)' })
  @ApiResponse({
    status: 200,
    description: 'List of organizations',
    type: [Organization],
  })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findAll() {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT, UserRole.LIGHT_AGENT)
  @ApiOperation({
    summary: 'Get an organization by ID (Admin/Agent/Light Agent)',
  })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiResponse({
    status: 200,
    description: 'Organization details',
    type: Organization,
  })
  @ApiNotFoundResponse({ description: 'Organization not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an organization (Admin only)' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiBody({ type: UpdateOrganizationDto })
  @ApiResponse({
    status: 200,
    description: 'Organization successfully updated',
    type: Organization,
  })
  @ApiNotFoundResponse({ description: 'Organization not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  update(
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete an organization (Admin only)' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiResponse({
    status: 200,
    description: 'Organization successfully deleted',
  })
  @ApiNotFoundResponse({ description: 'Organization not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
}
