import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
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
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { Tag } from './entities/tag.entity';

@ApiTags('Tags')
@ApiBearerAuth('JWT-auth')
@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Create a new tag (Admin/Agent only)' })
  @ApiBody({ type: CreateTagDto })
  @ApiCreatedResponse({ description: 'Tag successfully created', type: Tag })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  create(@Body() createTagDto: CreateTagDto) {
    return this.tagsService.create(createTagDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tags' })
  @ApiResponse({ status: 200, description: 'List of tags', type: [Tag] })
  findAll() {
    return this.tagsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a tag by ID' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiResponse({ status: 200, description: 'Tag details', type: Tag })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  findOne(@Param('id') id: string) {
    return this.tagsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Update a tag (Admin/Agent only)' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiBody({ type: UpdateTagDto })
  @ApiResponse({ status: 200, description: 'Tag successfully updated', type: Tag })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  update(@Param('id') id: string, @Body() updateTagDto: UpdateTagDto) {
    return this.tagsService.update(id, updateTagDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.AGENT)
  @ApiOperation({ summary: 'Delete a tag (Admin/Agent only)' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiResponse({ status: 200, description: 'Tag successfully deleted' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  remove(@Param('id') id: string) {
    return this.tagsService.remove(id);
  }
}

