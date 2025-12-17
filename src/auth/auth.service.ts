import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private sessionsService: SessionsService,
  ) {}

  async validateUser(
    email: string,
    password: string,
    organizationId?: string,
  ): Promise<any> {
    const user = await this.usersService.findByEmail(email, organizationId);
    if (user && (await bcrypt.compare(password, user.password))) {
      // Convert Mongoose document to plain object to ensure _id is included
      const userObject = user.toObject ? user.toObject() : user;
      const { password: _, ...result } = userObject;
      return result;
    }
    return null;
  }

  async login(user: any, context?: { ip: string; userAgent: string }) {
    // Note: user coming in might be from validateUser (LoginDto processing) or direct user object
    // If it's LoginDto, we need to validate. If it's already validated (from LocalStrategy), it is the user object.

    let validatedUser = user;
    if (user.email && user.password) {
      // It looks like a DTO
      const valid = await this.validateUser(
        user.email,
        user.password,
        user.organizationId,
      );
      if (!valid) throw new UnauthorizedException('Invalid credentials');
      validatedUser = valid;
    }

    // Create Session
    let sessionId;
    if (context) {
      const session = await this.sessionsService.create(
        validatedUser._id.toString(),
        context.userAgent || 'Unknown Device',
        context.ip || 'Unknown IP',
      );
      sessionId = session._id.toString();
    }

    const payload = this.getJwtPayload(validatedUser, sessionId);

    // Refresh token generation
    const refreshPayload = { ...payload, type: 'refresh' }; // Can be minimal

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: this.jwtService.sign(refreshPayload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>(
          'jwt.refreshExpiresIn',
        ) as any,
      }),
      user: {
        id: validatedUser._id.toString(),
        email: validatedUser.email,
        firstName: validatedUser.firstName,
        lastName: validatedUser.lastName,
        role: validatedUser.role,
        organizationId: validatedUser.organizationId?.toString() || null,
      },
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      // Check if user still exists
      const user = await this.usersService.findOne(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Generate new tokens
      const newPayload = this.getJwtPayload(user);

      return {
        access_token: this.jwtService.sign(newPayload),
        refresh_token: this.jwtService.sign(newPayload, {
          secret: this.configService.get<string>('jwt.refreshSecret'),
          expiresIn: this.configService.get<string>(
            'jwt.refreshExpiresIn',
          ) as any,
        }),
      };
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private getJwtPayload(user: any, sessionId?: string) {
    const userId = user._id.toString();
    const organizationId = user.organizationId?.toString();
    return {
      email: user.email,
      sub: userId,
      role: user.role,
      organizationId,
      sessionId,
    };
  }
}
