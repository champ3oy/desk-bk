import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.organizationId,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userId = user._id.toString();
    const organizationId = user.organizationId?.toString();
    const payload: any = {
      email: user.email,
      sub: userId,
      role: user.role,
    };
    if (organizationId) {
      payload.organizationId = organizationId;
    }
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: organizationId || null,
      },
    };
  }
}

