import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserDocument,
  UserResponse,
  UserRole,
  UserStatus,
} from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async setStatus(userId: string, status: UserStatus): Promise<UserResponse> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { status },
      { new: true },
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { password: _, ...result } = user.toObject();
    return result as UserResponse;
  }

  async create(createUserDto: CreateUserDto): Promise<UserResponse> {
    return this.createMembership(createUserDto);
  }

  async createMembership(
    createUserDto: CreateUserDto & { isPasswordHashed?: boolean },
  ): Promise<UserResponse> {
    // Check for email uniqueness globally (we want shared user accounts)
    const existingUser = await this.userModel.findOne({
      email: { $regex: new RegExp(`^${createUserDto.email}$`, 'i') },
    });

    if (existingUser) {
      if (!createUserDto.organizationId) {
        throw new ConflictException('User with this email already exists');
      }

      const orgId = createUserDto.organizationId;
      const orgIdObj = new Types.ObjectId(orgId);

      // Check if user is already a member of this organization
      const isMember =
        existingUser.organizationId?.equals(orgIdObj) ||
        existingUser.organizations?.some((o) =>
          o.organizationId.equals(orgIdObj),
        );

      if (isMember) {
        throw new ConflictException(
          'User with this email already exists in this organization',
        );
      }

      this.logger.log(
        `Adding existing user ${existingUser.email} to org ${orgId}`,
      );

      // Add to organizations array
      if (!existingUser.organizations) {
        existingUser.organizations = [];
      }

      existingUser.organizations.push({
        organizationId: orgIdObj,
        role: createUserDto.role || UserRole.CUSTOMER,
      });

      const savedUser = await existingUser.save();
      const { password: _, ...result } = savedUser.toObject();
      return result as UserResponse;
    }

    const password = createUserDto.isPasswordHashed
      ? createUserDto.password
      : await bcrypt.hash(createUserDto.password, 10);

    const userData: any = {
      ...createUserDto,
      password,
    };

    if (createUserDto.organizationId) {
      userData.organizationId = new Types.ObjectId(
        createUserDto.organizationId,
      );
      // Also add to organizations array for consistency
      userData.organizations = [
        {
          organizationId: userData.organizationId,
          role: createUserDto.role || UserRole.CUSTOMER,
        },
      ];
    }

    const user = new this.userModel(userData);
    const savedUser = await user.save();
    const { password: _, ...result } = savedUser.toObject();
    return result as UserResponse;
  }

  async findAll(organizationId?: string): Promise<UserResponse[]> {
    const query: any = {};
    if (organizationId) {
      const orgIdObj = new Types.ObjectId(organizationId);
      query.$or = [
        { organizationId: orgIdObj },
        { 'organizations.organizationId': orgIdObj },
      ];
    }
    return this.userModel
      .find(query)
      .select(
        'email firstName lastName role organizationId isActive createdAt updatedAt organizations',
      )
      .exec();
  }

  async findOne(id: string, organizationId?: string): Promise<UserResponse> {
    // Ensure id is a valid ObjectId, otherwise it will fail to match
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }

    const query: any = { _id: new Types.ObjectId(id) };
    if (organizationId) {
      // Check for both ObjectId and String format to handle potential data inconsistencies
      const orgIdObj = new Types.ObjectId(organizationId);
      query.$or = [
        { organizationId: { $in: [orgIdObj, organizationId] } },
        { 'organizations.organizationId': orgIdObj },
      ];
    }

    this.logger.debug(`findOne query: ${JSON.stringify(query)}`);

    const user = await this.userModel
      .findOne(query)
      .select(
        'email firstName lastName role organizationId isActive createdAt updatedAt signature organizations',
      )
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(
    email: string,
    organizationId?: string,
  ): Promise<UserDocument | null> {
    const query: any = { email: { $regex: new RegExp(`^${email}$`, 'i') } };
    if (organizationId) {
      // Check for both ObjectId and String format to handle potential data inconsistencies
      const orgIdObj = new Types.ObjectId(organizationId);
      query.$or = [
        { organizationId: { $in: [orgIdObj, organizationId] } },
        { 'organizations.organizationId': orgIdObj },
      ];
    }
    this.logger.debug(`findByEmail query: ${JSON.stringify(query)}`);
    const user = await this.userModel.findOne(query).exec();
    if (!user) {
      // Try to find user without org filter to see if they exist
      const userWithoutOrg = await this.userModel.findOne({ email }).exec();
      if (userWithoutOrg) {
        this.logger.warn(
          `User found with email=${email} but orgId=${userWithoutOrg.organizationId?.toString()} doesn't match requested orgId=${organizationId}`,
        );
      } else {
        this.logger.warn(`No user found with email=${email}`);
      }
    } else {
      this.logger.debug(
        `User found: email=${user.email}, orgId=${user.organizationId?.toString()}`,
      );
    }
    return user;
  }

  async findAllByEmail(email: string): Promise<UserDocument[]> {
    return this.userModel
      .find({ email: { $regex: new RegExp(`^${email}$`, 'i') } })
      .exec();
  }

  async findByEmailAndOrg(
    email: string,
    organizationId: string,
  ): Promise<UserDocument | null> {
    const orgIdObj = new Types.ObjectId(organizationId);
    return this.userModel
      .findOne({
        email: { $regex: new RegExp(`^${email}$`, 'i') },
        $or: [
          { organizationId: { $in: [orgIdObj, organizationId] } },
          { 'organizations.organizationId': orgIdObj },
        ],
      })
      .exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    organizationId?: string,
  ): Promise<UserResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }

    const query: any = { _id: new Types.ObjectId(id) };
    if (organizationId) {
      query.organizationId = {
        $in: [new Types.ObjectId(organizationId), organizationId],
      };
    }

    this.logger.debug(`update query: ${JSON.stringify(query)}`);

    // Find the user first to verify existence and check email uniqueness
    const userDoc = await this.userModel
      .findOne(query)
      .select('email organizationId')
      .exec();

    if (!userDoc) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (updateUserDto.email && updateUserDto.email !== userDoc.email) {
      // Check for global uniqueness of email
      const existingUser = await this.userModel.findOne({
        email: { $regex: new RegExp(`^${updateUserDto.email}$`, 'i') },
      });

      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // Create a copy of updates
    const updates: any = { ...updateUserDto };

    // Handle organizationId if provided
    if (updates.organizationId) {
      updates.organizationId = new Types.ObjectId(updates.organizationId);
    }

    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    // Use findByIdAndUpdate to avoid validating the entire document
    // which might fail if legacy data is missing required fields (like password/email)
    const updatedUser = await this.userModel
      .findByIdAndUpdate(query._id, { $set: updates }, { new: true })
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const { password: _, ...result } = updatedUser.toObject();
    return result as UserResponse;
  }

  async remove(id: string, organizationId?: string): Promise<void> {
    await this.findOne(id, organizationId);
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = new Types.ObjectId(organizationId);
    }
    await this.userModel.findOneAndDelete(query).exec();
  }

  async addOrganizationToUser(
    userId: string,
    organizationId: string,
    role: UserRole = UserRole.ADMIN,
  ): Promise<UserResponse> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const orgIdObj = new Types.ObjectId(organizationId);

    // Initial check: if user has no org, set it as primary (backward compatibility)
    // But we prefer using the array now.
    // If we want to move fully to array, we should populate array even if organizationId is set.

    if (!user.organizations) {
      user.organizations = [];
    }

    // Check if already member
    const isMember =
      user.organizationId?.equals(orgIdObj) ||
      user.organizations.some((o) => o.organizationId.equals(orgIdObj));

    if (isMember) {
      // Already member, maybe update role? For now, just return.
      const { password: _, ...result } = user.toObject();
      return result as UserResponse;
    }

    // Add to organizations
    user.organizations.push({
      organizationId: orgIdObj,
      role: role,
    });

    // If user has no primary org, set this one as primary too (optional, but good for legacy checks)
    if (!user.organizationId) {
      user.organizationId = orgIdObj;
      user.role = role;
    }

    const savedUser = await user.save();
    this.logger.log(`Added user ${user.email} to org ${organizationId}`);

    const { password: _, ...result } = savedUser.toObject();
    return result as UserResponse;
  }
}
