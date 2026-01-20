import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MacrosService } from './macros.service';
import { MacrosController } from './macros.controller';
import { Macro, MacroSchema } from './entities/macro.entity';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Macro.name, schema: MacroSchema }]),
  ],
  controllers: [MacrosController],
  providers: [MacrosService],
  exports: [MacrosService],
})
export class MacrosModule {}
