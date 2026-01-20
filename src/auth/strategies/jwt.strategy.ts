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
    const secret =
      configService.get<string>('jwt.secret') ||
      'your-secret-key-change-in-production';
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    try {
      // Check for Organization Switch Header
      const switchOrgId = req.headers['x-organization-id'];

      // Validate Org ID format if present (must be 24-char hex)
      const isValidOrgId = (id: any) =>
        typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

      const targetOrgId = isValidOrgId(switchOrgId)
        ? switchOrgId
        : isValidOrgId(payload.organizationId)
          ? payload.organizationId
          : undefined;

      this.logger.log(
        `Validating JWT for email=${payload.email} targetOrg=${targetOrgId || 'none'}`,
      );

      let user = await this.usersService.findByEmail(
        payload.email,
        targetOrgId,
      );

      // Fallback: if switching failed or org filter yielded nothing, default to the one in payload
      if (!user && switchOrgId && targetOrgId !== payload.organizationId) {
        this.logger.warn(
          `Switch to org ${switchOrgId} failed for ${payload.email}, falling back to payload org`,
        );
        user = await this.usersService.findByEmail(
          payload.email,
          isValidOrgId(payload.organizationId)
            ? payload.organizationId
            : undefined,
        );
      }

      // Final fallback: try without organizationId filter if user not found at all
      if (!user) {
        this.logger.debug(
          `User not found with org filter, trying without org filter for email=${payload.email}`,
        );
        user = await this.usersService.findByEmail(payload.email);
      }

      if (!user) {
        this.logger.warn(
          `User not found for email=${payload.email} org=${targetOrgId || 'none'}`,
        );
        throw new UnauthorizedException();
      }
      const userId = user._id.toString();
      const userOrgId = user.organizationId?.toString();

      // Use the X-Organization-Id header if valid, otherwise fall back to user's org
      // This allows users who belong to multiple orgs to switch context
      const effectiveOrgId = isValidOrgId(switchOrgId)
        ? switchOrgId
        : userOrgId;

      this.logger.debug(
        `User ${userId} effective org: ${effectiveOrgId} (header: ${switchOrgId || 'none'}, user: ${userOrgId || 'none'})`,
      );

      return {
        userId,
        email: user.email,
        role: user.role,
        organizationId: effectiveOrgId || null,
      };
    } catch (error) {
      this.logger.error(
        `JWT validation failed for email=${payload?.email ?? 'unknown'}`,
      );
      throw new UnauthorizedException();
    }
  }
}
