import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserResponse } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponse> {
    return this.createMembership(createUserDto);
  }

  async createMembership(
    createUserDto: CreateUserDto & { isPasswordHashed?: boolean },
  ): Promise<UserResponse> {
    // Check for global uniqueness of email
    const existingUser = await this.userModel.findOne({
      email: { $regex: new RegExp(`^${createUserDto.email}$`, 'i') },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const password = createUserDto.isPasswordHashed
      ? createUserDto.password
      : await bcrypt.hash(createUserDto.password, 10);

    console.log(
      `UsersService.createMembership: creating record for ${createUserDto.email} with password length ${password?.length || 0}`,
    );

    const userData: any = {
      ...createUserDto,
      password,
    };

    if (createUserDto.organizationId) {
      userData.organizationId = new Types.ObjectId(
        createUserDto.organizationId,
      );
    }

    const user = new this.userModel(userData);
    const savedUser = await user.save();
    const { password: _, ...result } = savedUser.toObject();
    return result as UserResponse;
  }

  async findAll(organizationId?: string): Promise<UserResponse[]> {
    const query = organizationId
      ? { organizationId: new Types.ObjectId(organizationId) }
      : {};
    return this.userModel
      .find(query)
      .select(
        'email firstName lastName role organizationId isActive createdAt updatedAt',
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
      query.organizationId = {
        $in: [new Types.ObjectId(organizationId), organizationId],
      };
    }

    this.logger.debug(`findOne query: ${JSON.stringify(query)}`);

    const user = await this.userModel
      .findOne(query)
      .select(
        'email firstName lastName role organizationId isActive createdAt updatedAt',
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
      query.organizationId = {
        $in: [new Types.ObjectId(organizationId), organizationId],
      };
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

    const userDoc = await this.userModel.findOne(query).exec();

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

    // Create a copy of updates to avoid mutating the DTO or overwriting handled fields
    const updates: any = { ...updateUserDto };

    // Handle organizationId if provided as string
    if (updates.organizationId) {
      userDoc.organizationId = new Types.ObjectId(updates.organizationId);
      delete updates.organizationId; // Remove so Object.assign doesn't overwrite with string
    }

    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    Object.assign(userDoc, updates);
    const savedUser = await userDoc.save();
    const { password: _, ...result } = savedUser.toObject();
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
}
