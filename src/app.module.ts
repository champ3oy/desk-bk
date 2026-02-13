import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { CustomersModule } from './customers/customers.module';
import { InvitationsModule } from './invitations/invitations.module';
import { GroupsModule } from './groups/groups.module';
import { ThreadsModule } from './threads/threads.module';
import { TicketsModule } from './tickets/tickets.module';
import { CommentsModule } from './comments/comments.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AiModule } from './ai/ai.module';
import { TrainingModule } from './training/training.module';
import { SessionsModule } from './sessions/sessions.module';
import { InvoicesModule } from './invoices/invoices.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { MacrosModule } from './macros/macros.module';
import { IngestionModule } from './ingestion/ingestion.module';

import databaseConfig from './config/database.config';
import aiConfig from './config/ai.config';
import jwtConfig from './config/jwt.config';

import { EmailModule } from './email/email.module';

import { StorageModule } from './storage/storage.module';
import { LoggerModule } from './logger/logger.module';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggingInterceptor } from './logger/logging.interceptor';
import { AllExceptionsFilter } from './logger/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, aiConfig, jwtConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        let connection = {};

        if (redisUrl) {
          try {
            const url = new URL(redisUrl);
            connection = {
              host: url.hostname,
              port: Number(url.port),
              username: url.username,
              password: url.password,
              db:
                url.pathname && url.pathname.length > 1
                  ? Number(url.pathname.substring(1))
                  : 0,
            };
          } catch (e) {
            // Fallback or leave empty to default to localhost
            console.warn('Invalid REDIS_URL, using defaults', e);
          }
        }

        return {
          connection,
        };
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),

    LoggerModule,
    CommonModule,
    EmailModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    CustomersModule,
    InvitationsModule,
    GroupsModule,
    TicketsModule,
    ThreadsModule,
    CommentsModule,
    CategoriesModule,
    TagsModule,
    AttachmentsModule,
    AiModule,
    TrainingModule,
    IntegrationsModule,
    SessionsModule,
    InvoicesModule,
    NotificationsModule,
    MacrosModule,
    AnalyticsModule,

    StorageModule, // Line 68
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
