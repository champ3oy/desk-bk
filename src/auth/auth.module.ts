import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import jwtConfig from '../config/jwt.config';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    SessionsModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule.forRoot({ load: [jwtConfig] })],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>('jwt.expiresIn') || '7d';
        return {
          secret:
            configService.get<string>('jwt.secret') ||
            'your-secret-key-change-in-production',
          signOptions: {
            expiresIn: expiresIn as any,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
