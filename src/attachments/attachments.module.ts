import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { Attachment, AttachmentSchema } from './entities/attachment.entity';
import { Ticket, TicketSchema } from '../tickets/entities/ticket.entity';
import { Comment, CommentSchema } from '../comments/entities/comment.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attachment.name, schema: AttachmentSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
