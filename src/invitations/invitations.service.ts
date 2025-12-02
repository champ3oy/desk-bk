import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  Invitation,
  InvitationDocument,
  InvitationStatus,
} from './entities/invitation.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    private usersService: UsersService,
  ) {}

  async create(
    createInvitationDto: CreateInvitationDto,
    organizationId: string,
    invitedBy: string,
  ): Promise<Invitation> {
    // Check if user already exists in this organization
    const existingUser = await this.usersService.findByEmail(
      createInvitationDto.email,
      organizationId,
    );

    if (existingUser) {
      throw new ConflictException(
        'User with this email already exists in this organization',
      );
    }

    // Check for pending invitation
    const pendingInvitation = await this.invitationModel.findOne({
      email: createInvitationDto.email,
      organizationId: new Types.ObjectId(organizationId),
      status: InvitationStatus.PENDING,
      expiresAt: { $gt: new Date() },
    });

    if (pendingInvitation) {
      throw new ConflictException(
        'A pending invitation already exists for this email',
      );
    }

    // Generate secure token
    const token = this.generateToken();

    // Set expiration (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = new this.invitationModel({
      ...createInvitationDto,
      token,
      organizationId: new Types.ObjectId(organizationId),
      invitedBy: new Types.ObjectId(invitedBy),
      status: InvitationStatus.PENDING,
      expiresAt,
    });

    return invitation.save();
  }

  async findByToken(token: string): Promise<InvitationDocument> {
    const invitation = await this.invitationModel.findOne({ token }).exec();

    if (!invitation) {
      throw new NotFoundException('Invalid invitation token');
    }

    // Check if expired
    if (invitation.expiresAt < new Date()) {
      invitation.status = InvitationStatus.EXPIRED;
      await invitation.save();
      throw new BadRequestException('Invitation has expired');
    }

    // Check status
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation has been ${invitation.status}`,
      );
    }

    return invitation;
  }

  async accept(
    acceptInvitationDto: AcceptInvitationDto,
  ): Promise<{ user: any; invitation: Invitation }> {
    const invitation = await this.findByToken(acceptInvitationDto.token);

    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(
      invitation.email,
      invitation.organizationId.toString(),
    );

    if (existingUser) {
      throw new ConflictException(
        'User with this email already exists. Please login instead.',
      );
    }

    // Create user account (UsersService will hash the password)
    const user = await this.usersService.create({
      email: invitation.email,
      password: acceptInvitationDto.password,
      firstName: acceptInvitationDto.firstName || invitation.firstName,
      lastName: acceptInvitationDto.lastName || invitation.lastName,
      organizationId: invitation.organizationId.toString(),
      role: invitation.role,
    });

    // Update invitation status
    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    await invitation.save();

    // UserResponse already excludes password, so we can return it directly
    return {
      user,
      invitation: invitation.toObject(),
    };
  }

  async findAll(organizationId: string): Promise<InvitationDocument[]> {
    return this.invitationModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .populate('invitedBy', 'email firstName lastName')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string, organizationId: string): Promise<InvitationDocument> {
    const invitation = await this.invitationModel
      .findOne({
        _id: id,
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate('invitedBy', 'email firstName lastName')
      .exec();

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${id} not found`);
    }

    return invitation;
  }

  async resend(id: string, organizationId: string): Promise<InvitationDocument> {
    const invitation = await this.findOne(id, organizationId);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        'Can only resend pending invitations',
      );
    }

    // Generate new token and extend expiration
    invitation.token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    invitation.expiresAt = expiresAt;

    return invitation.save();
  }

  async cancel(id: string, organizationId: string): Promise<void> {
    const invitation = await this.findOne(id, organizationId);

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        'Can only cancel pending invitations',
      );
    }

    invitation.status = InvitationStatus.CANCELLED;
    await invitation.save();
  }

  private generateToken(): string {
    // Generate a secure random token
    // Using UUID v4 + timestamp for uniqueness
    return `${randomUUID()}-${Date.now()}`.replace(/-/g, '');
  }
}

