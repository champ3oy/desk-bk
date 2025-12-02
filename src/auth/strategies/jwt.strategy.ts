import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const secret = configService.get<string>('jwt.secret') || 'your-secret-key-change-in-production';
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    try {
      const user = await this.usersService.findByEmail(
        payload.email,
        payload.organizationId,
      );
      if (!user || !user.isActive) {
        throw new UnauthorizedException();
      }
      const userId = user._id.toString();
      const organizationId = user.organizationId?.toString();
      return {
        userId,
        email: user.email,
        role: user.role,
        organizationId: organizationId || null,
      };
    } catch (error) {
      throw new UnauthorizedException();
    }
  }
}

