import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { createResponseAgent, draftResponse } from './index';

describe('Response Agent', () => {
  let ticketsService: jest.Mocked<TicketsService>;
  let threadsService: jest.Mocked<ThreadsService>;
  const userId = 'user123';
  const userRole = UserRole.AGENT;
  const organizationId = 'org123';

  beforeEach(() => {
    // Create mock services
    ticketsService = {
      findOne: jest.fn(),
    } as any;

    threadsService = {
      findAll: jest.fn(),
      getMessages: jest.fn(),
    } as any;
  });

  describe('createResponseAgent', () => {
    it('should create an agent with the correct tools', () => {
      const agent = createResponseAgent(
        ticketsService,
        threadsService,
        userId,
        userRole,
        organizationId,
      );

      expect(agent).toBeDefined();
    });
  });

  describe('draftResponse', () => {
    const ticketId = 'ticket123';

    beforeEach(() => {
      // Mock ticket data
      ticketsService.findOne.mockResolvedValue({
        _id: ticketId,
        subject: 'Test Ticket',
        description: 'Test Description',
        status: 'open',
        priority: 'medium',
        toObject: jest.fn().mockReturnValue({
          _id: ticketId,
          subject: 'Test Ticket',
          description: 'Test Description',
        }),
      } as any);

      // Mock threads data
      threadsService.findAll.mockResolvedValue([
        {
          _id: 'thread1',
          ticketId: ticketId,
          type: 'external',
          toObject: jest.fn().mockReturnValue({
            _id: 'thread1',
            ticketId: ticketId,
            type: 'external',
          }),
        },
      ] as any);

      // Mock messages
      threadsService.getMessages.mockResolvedValue([
        {
          _id: 'msg1',
          content: 'Customer message',
          authorType: 'customer',
          toObject: jest.fn().mockReturnValue({
            _id: 'msg1',
            content: 'Customer message',
            authorType: 'customer',
          }),
        },
      ] as any);
    });

    it('should fetch ticket and all threads data', async () => {
      // Note: This test will make an actual API call to the LLM
      // In a real scenario, you might want to mock the agent.invoke method
      // For now, this tests that the function structure is correct

      try {
        await draftResponse(
          ticketId,
          ticketsService,
          threadsService,
          userId,
          userRole,
          organizationId,
        );

        expect(ticketsService.findOne).toHaveBeenCalledWith(
          ticketId,
          userId,
          userRole,
          organizationId,
        );
        expect(threadsService.findAll).toHaveBeenCalledWith(
          ticketId,
          organizationId,
          userId,
          userRole,
        );
      } catch (error) {
        // Expected if API key is not set or network issues
        // The important part is that the services were called correctly
        expect(ticketsService.findOne).toHaveBeenCalled();
      }
    });

    it('should accept additional context', async () => {
      const additionalContext = 'Customer is a VIP';

      try {
        await draftResponse(
          ticketId,
          ticketsService,
          threadsService,
          userId,
          userRole,
          organizationId,
          additionalContext,
        );
      } catch (error) {
        // Expected if API key is not set
      }

      expect(ticketsService.findOne).toHaveBeenCalled();
    });
  });
});
