import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { Logtail } from '@logtail/node';
import { LogtailTransport } from '@logtail/winston';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logtailToken = configService.get<string>('LOGTAIL_SOURCE_TOKEN');
        const transports: winston.transport[] = [];

        // Console transport for local development
        transports.push(
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.ms(),
              winston.format.colorize({ all: true }),
              winston.format.printf(
                ({ timestamp, level, message, context, stack, ms }) => {
                  return `[Nest] ${process.pid}  - ${timestamp}     ${level} [${context || 'Application'}] ${message} ${ms} ${stack ? '\n' + stack : ''}`;
                },
              ),
            ),
          }),
        );

        // Add Logtail transport only if token is present
        if (logtailToken) {
          const logtail = new Logtail(logtailToken);
          transports.push(new LogtailTransport(logtail));
        }

        return {
          transports,
          // Set logging level based on environment
          level:
            configService.get('NODE_ENV') === 'production' ? 'info' : 'debug',
        };
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
