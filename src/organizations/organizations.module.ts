import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { ElevenLabsModule } from '../integrations/elevenlabs/elevenlabs.module';
import { forwardRef } from '@nestjs/common';
import {
  Organization,
  OrganizationSchema,
} from './entities/organization.entity';
import { UsersModule } from '../users/users.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    UsersModule,
    InvoicesModule,
    forwardRef(() => ElevenLabsModule),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
