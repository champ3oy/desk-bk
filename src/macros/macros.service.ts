import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Macro, MacroDocument, MacroVisibility } from './entities/macro.entity';
import { CreateMacroDto } from './dto/create-macro.dto';
import { UpdateMacroDto } from './dto/update-macro.dto';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class MacrosService {
  constructor(
    @InjectModel(Macro.name) private macroModel: Model<MacroDocument>,
  ) {}

  async create(
    createMacroDto: CreateMacroDto,
    userId: string,
    organizationId: string,
  ): Promise<Macro> {
    // Check if shortcut already exists in this organization
    const existingMacro = await this.macroModel.findOne({
      shortcut: createMacroDto.shortcut,
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    });

    if (existingMacro) {
      throw new BadRequestException(
        `Shortcut "${createMacroDto.shortcut}" is already in use`,
      );
    }

    const macro = new this.macroModel({
      ...createMacroDto,
      organizationId: new Types.ObjectId(organizationId),
      createdBy: new Types.ObjectId(userId),
      visibility: createMacroDto.visibility || MacroVisibility.PRIVATE,
      sharedWithTeams: createMacroDto.sharedWithTeams?.map(
        (id) => new Types.ObjectId(id),
      ),
    });

    return macro.save();
  }

  async findAll(
    userId: string,
    organizationId: string,
    userRole: UserRole,
    userTeams?: string[],
  ): Promise<Macro[]> {
    const query: any = {
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    };

    // Build visibility filter based on user role and permissions
    const visibilityConditions: any[] = [
      // User's own private macros
      {
        createdBy: new Types.ObjectId(userId),
        visibility: MacroVisibility.PRIVATE,
      },
      // Organization-wide macros
      { visibility: MacroVisibility.ORGANIZATION },
    ];

    // Team macros - user can see if they're in the team
    if (userTeams && userTeams.length > 0) {
      visibilityConditions.push({
        visibility: MacroVisibility.TEAM,
        sharedWithTeams: {
          $in: userTeams.map((id) => new Types.ObjectId(id)),
        },
      });
    }

    // Admins can see all team macros in their organization
    if (userRole === UserRole.ADMIN) {
      visibilityConditions.push({
        visibility: MacroVisibility.TEAM,
      });
    }

    query.$or = visibilityConditions;

    return this.macroModel
      .find(query)
      .sort({ usageCount: -1, createdAt: -1 })
      .exec();
  }

  async findOne(
    id: string,
    userId: string,
    organizationId: string,
    userRole: UserRole,
    userTeams?: string[],
  ): Promise<Macro> {
    const macro = await this.macroModel.findById(id).exec();

    if (!macro) {
      throw new NotFoundException(`Macro with ID "${id}" not found`);
    }

    // Check if user has access to this macro
    const hasAccess = this.checkMacroAccess(
      macro,
      userId,
      organizationId,
      userRole,
      userTeams,
    );

    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this macro');
    }

    return macro;
  }

  async update(
    id: string,
    updateMacroDto: UpdateMacroDto,
    userId: string,
    organizationId: string,
    userRole: UserRole,
  ): Promise<Macro> {
    const macro = await this.macroModel.findById(id).exec();

    if (!macro) {
      throw new NotFoundException(`Macro with ID "${id}" not found`);
    }

    // Check if user can edit this macro
    const canEdit = this.checkMacroEditPermission(
      macro,
      userId,
      organizationId,
      userRole,
    );

    if (!canEdit) {
      throw new ForbiddenException(
        'You do not have permission to edit this macro',
      );
    }

    // If shortcut is being changed, check for conflicts
    if (updateMacroDto.shortcut && updateMacroDto.shortcut !== macro.shortcut) {
      const existingMacro = await this.macroModel.findOne({
        shortcut: updateMacroDto.shortcut,
        organizationId: new Types.ObjectId(organizationId),
        isActive: true,
        _id: { $ne: id },
      });

      if (existingMacro) {
        throw new BadRequestException(
          `Shortcut "${updateMacroDto.shortcut}" is already in use`,
        );
      }
    }

    // Update shared teams if provided
    if (updateMacroDto.sharedWithTeams) {
      macro.sharedWithTeams = updateMacroDto.sharedWithTeams.map(
        (id) => new Types.ObjectId(id),
      );
    }

    Object.assign(macro, updateMacroDto);
    return macro.save();
  }

  async remove(
    id: string,
    userId: string,
    organizationId: string,
    userRole: UserRole,
  ): Promise<void> {
    const macro = await this.macroModel.findById(id).exec();

    if (!macro) {
      throw new NotFoundException(`Macro with ID "${id}" not found`);
    }

    // Check if user can delete this macro
    const canDelete = this.checkMacroEditPermission(
      macro,
      userId,
      organizationId,
      userRole,
    );

    if (!canDelete) {
      throw new ForbiddenException(
        'You do not have permission to delete this macro',
      );
    }

    // Soft delete by setting isActive to false
    macro.isActive = false;
    await macro.save();
  }

  async incrementUsage(id: string): Promise<void> {
    await this.macroModel
      .findByIdAndUpdate(id, {
        $inc: { usageCount: 1 },
        $set: { lastUsedAt: new Date() },
      })
      .exec();
  }

  async searchByShortcut(
    shortcut: string,
    userId: string,
    organizationId: string,
    userRole: UserRole,
    userTeams?: string[],
  ): Promise<Macro | null> {
    const query: any = {
      shortcut,
      organizationId: new Types.ObjectId(organizationId),
      isActive: true,
    };

    // Build visibility filter
    const visibilityConditions: any[] = [
      {
        createdBy: new Types.ObjectId(userId),
        visibility: MacroVisibility.PRIVATE,
      },
      { visibility: MacroVisibility.ORGANIZATION },
    ];

    if (userTeams && userTeams.length > 0) {
      visibilityConditions.push({
        visibility: MacroVisibility.TEAM,
        sharedWithTeams: {
          $in: userTeams.map((id) => new Types.ObjectId(id)),
        },
      });
    }

    if (userRole === UserRole.ADMIN) {
      visibilityConditions.push({
        visibility: MacroVisibility.TEAM,
      });
    }

    query.$or = visibilityConditions;

    const macro = await this.macroModel.findOne(query).exec();

    if (macro) {
      // Increment usage count asynchronously
      this.incrementUsage(macro._id.toString()).catch((err) =>
        console.error('Failed to increment macro usage:', err),
      );
    }

    return macro;
  }

  private checkMacroAccess(
    macro: MacroDocument,
    userId: string,
    organizationId: string,
    userRole: UserRole,
    userTeams?: string[],
  ): boolean {
    // Check organization
    if (macro.organizationId.toString() !== organizationId) {
      return false;
    }

    // Check if inactive
    if (!macro.isActive) {
      return false;
    }

    // Organization-wide macros are accessible to all
    if (macro.visibility === MacroVisibility.ORGANIZATION) {
      return true;
    }

    // Private macros are only accessible to creator
    if (macro.visibility === MacroVisibility.PRIVATE) {
      return macro.createdBy.toString() === userId;
    }

    // Team macros
    if (macro.visibility === MacroVisibility.TEAM) {
      // Admins can access all team macros
      if (userRole === UserRole.ADMIN) {
        return true;
      }

      // Check if user is in any of the shared teams
      if (userTeams && userTeams.length > 0 && macro.sharedWithTeams) {
        return macro.sharedWithTeams.some((teamId) =>
          userTeams.includes(teamId.toString()),
        );
      }
    }

    return false;
  }

  private checkMacroEditPermission(
    macro: MacroDocument,
    userId: string,
    organizationId: string,
    userRole: UserRole,
  ): boolean {
    // Check organization
    if (macro.organizationId.toString() !== organizationId) {
      return false;
    }

    // Admins can edit any macro in their organization
    if (userRole === UserRole.ADMIN) {
      return true;
    }

    // Users can only edit their own macros
    return macro.createdBy.toString() === userId;
  }
}
