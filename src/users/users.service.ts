import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserResponse } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponse> {
    // If organizationId is provided, check for uniqueness within that org
    // Otherwise, check for global uniqueness (user without org)
    const query: any = { email: createUserDto.email };
    if (createUserDto.organizationId) {
      query.organizationId = new Types.ObjectId(createUserDto.organizationId);
    } else {
      query.organizationId = { $exists: false };
    }

    const existingUser = await this.userModel.findOne(query);

    if (existingUser) {
      if (createUserDto.organizationId) {
        throw new ConflictException(
          'User with this email already exists in this organization',
        );
      } else {
        throw new ConflictException('User with this email already exists');
      }
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    const userData: any = {
      ...createUserDto,
      password: hashedPassword,
    };

    if (createUserDto.organizationId) {
      userData.organizationId = new Types.ObjectId(createUserDto.organizationId);
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
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = new Types.ObjectId(organizationId);
    }

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
    const query: any = { email };
    if (organizationId) {
      query.organizationId = new Types.ObjectId(organizationId);
    }
    return this.userModel.findOne(query).exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    organizationId?: string,
  ): Promise<UserResponse> {
    const query: any = { _id: id };
    if (organizationId) {
      query.organizationId = new Types.ObjectId(organizationId);
    }

    const userDoc = await this.userModel.findOne(query).exec();

    if (!userDoc) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (updateUserDto.email && updateUserDto.email !== userDoc.email) {
      const orgId = organizationId || (userDoc.organizationId?.toString());
      if (!orgId) {
        // User doesn't have an org yet, check globally
        const existingUser = await this.userModel.findOne({
          email: updateUserDto.email,
          organizationId: { $exists: false },
        });
        if (existingUser) {
          throw new ConflictException('User with this email already exists');
        }
      } else {
        const existingUser = await this.userModel.findOne({
          email: updateUserDto.email,
          organizationId: new Types.ObjectId(orgId),
        });

        if (existingUser) {
          throw new ConflictException(
            'User with this email already exists in this organization',
          );
        }
      }
    }

    // Handle organizationId if provided as string
    if (updateUserDto.organizationId) {
      userDoc.organizationId = new Types.ObjectId(updateUserDto.organizationId);
    }

    Object.assign(userDoc, updateUserDto);
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

