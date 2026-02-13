import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AIUsageLog, AIUsageLogSchema } from './entities/ai-usage-log.entity';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TelemetryInterceptor } from './telemetry.interceptor';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIUsageLog.name, schema: AIUsageLogSchema },
    ]),
  ],
  controllers: [AiUsageController],
  providers: [
    AiUsageService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TelemetryInterceptor,
    },
  ],
  exports: [AiUsageService],
})
export class AiTelemetryModule {}
