import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
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
      this.logger.log(
        `Validating JWT for email=${payload.email} org=${payload.organizationId || 'none'}`,
      );
      let user = await this.usersService.findByEmail(
        payload.email,
        payload.organizationId,
      );
      
      // Fallback: try without organizationId filter if user not found
      if (!user && payload.organizationId) {
        this.logger.debug(
          `User not found with org filter, trying without org filter for email=${payload.email}`,
        );
        user = await this.usersService.findByEmail(payload.email);
      }
      
      if (!user) {
        this.logger.warn(
          `User not found for email=${payload.email} org=${payload.organizationId || 'none'}`,
        );
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
      this.logger.error(
        `JWT validation failed for email=${payload?.email ?? 'unknown'} org=${payload?.organizationId ?? 'none'}`,
      );
      throw new UnauthorizedException();
    }
  }
}

