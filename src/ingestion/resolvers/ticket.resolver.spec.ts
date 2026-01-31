import { Test, TestingModule } from '@nestjs/testing';
import { TicketResolver } from './ticket.resolver';
import { getModelToken } from '@nestjs/mongoose';
import { TicketsService } from '../../tickets/tickets.service';
import { MessageChannel } from '../../threads/entities/message.entity';
import { Types } from 'mongoose';

describe('TicketResolver', () => {
  let resolver: TicketResolver;
  let messageModelDesc: any;
  let threadModelDesc: any;
  let ticketModelDesc: any;

  beforeEach(async () => {
    // Mock Mongoose Models
    messageModelDesc = {
      findOne: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };

    threadModelDesc = {
      findOne: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };

    ticketModelDesc = {
      findOne: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), ticketId: 12345 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketResolver,
        {
          provide: getModelToken('Message'),
          useValue: messageModelDesc,
        },
        {
          provide: getModelToken('Thread'),
          useValue: threadModelDesc,
        },
        // Also mock Ticket Model if needed by TicketsService
        {
          provide: getModelToken('Ticket'),
          useValue: ticketModelDesc,
        },
        {
          provide: TicketsService,
          useValue: {
            findTicketIdsBySubject: jest.fn(),
          },
        },
      ],
    }).compile();

    resolver = module.get<TicketResolver>(TicketResolver);
  });

  it('should FAIL to resolve by subject (Issue 1 Reproduction)', async () => {
    const mockMessage = {
      channel: MessageChannel.EMAIL,
      subject: 'Re: [Ticket #12345] Help me',
      content: 'Reply body',
      senderEmail: 'cust@example.com',
      // NO Headers for In-Reply-To
      inReplyTo: undefined,
      references: undefined,
      messageId: '<new-id@example.com>',
      metadata: {},
      attachments: [],
      rawBody: '',
      recipientEmail: 'support@desk.com',
      senderName: 'Customer',
    };

    // We expect this to return '12345' IF the feature existed.
    // Since it doesn't, it returns null.
    const result = await resolver.resolve(
      mockMessage,
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
    );

    // This assertion expects the BUG (current behavior) to prove it exists.
    // If I asserted expect(result).toBe('12345'), the test would fail, which also proves it.
    // I will write the test to EXPECT the feature, so the test FAILS.
    expect(result).toBe('12345');
  });
});
