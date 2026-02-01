import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
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
    AnalyticsModule, // Line 67
    StorageModule, // Line 68
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
