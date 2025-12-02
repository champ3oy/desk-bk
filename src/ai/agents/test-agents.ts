/**
 * Manual Testing Script for AI Agents
 * 
 * This script helps you manually test the response and sentiment agents.
 * 
 * Usage:
 * 1. Make sure your database is running and populated with test data
 * 2. Set up your environment variables (GEMINI_API_KEY in .env file)
 * 3. Import this file in a NestJS service or controller, or run it directly
 * 
 * Example usage in a controller:
 * 
 * import { draftResponse } from './ai/agents/response';
 * import { analyzeSentiment } from './ai/agents/sentiment';
 * 
 * // In your controller method:
 * const response = await draftResponse(
 *   ticketId,
 *   this.ticketsService,
 *   this.threadsService,
 *   this.configService,
 *   req.user.userId,
 *   req.user.role,
 *   req.user.organizationId,
 * );
 * 
 * const sentiment = await analyzeSentiment(
 *   ticketId,
 *   this.ticketsService,
 *   this.threadsService,
 *   this.commentsService,
 *   this.configService,
 *   req.user.userId,
 *   req.user.role,
 *   req.user.organizationId,
 * );
 */

import { ConfigService } from '@nestjs/config';
import { draftResponse } from './response';
import { analyzeSentiment } from './sentiment';
import { TicketsService } from '../../tickets/tickets.service';
import { ThreadsService } from '../../threads/threads.service';
import { CommentsService } from '../../comments/comments.service';
import { UserRole } from '../../users/entities/user.entity';

/**
 * Example function to test the response agent
 * Replace with actual service instances and IDs from your database
 */
export async function testResponseAgent(
  ticketId: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) {
  console.log('Testing Response Agent...');
  console.log(`Ticket ID: ${ticketId}`);

  try {
    const result = await draftResponse(
      ticketId,
      ticketsService,
      threadsService,
      configService,
      userId,
      userRole,
      organizationId,
      'Customer is a VIP member',
    );

    console.log('Response Agent Result:');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error testing response agent:', error);
    throw error;
  }
}

/**
 * Example function to test the sentiment agent
 * Replace with actual service instances and IDs from your database
 */
export async function testSentimentAgent(
  ticketId: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) {
  console.log('Testing Sentiment Agent...');
  console.log(`Ticket ID: ${ticketId}`);

  try {
    const result = await analyzeSentiment(
      ticketId,
      ticketsService,
      threadsService,
      commentsService,
      configService,
      userId,
      userRole,
      organizationId,
    );

    console.log('Sentiment Agent Result:');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error testing sentiment agent:', error);
    throw error;
  }
}

/**
 * Test both agents together
 */
export async function testBothAgents(
  ticketId: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) {
  console.log('=== Testing Both Agents ===\n');

  // First analyze sentiment
  const sentiment = await testSentimentAgent(
    ticketId,
    ticketsService,
    threadsService,
    commentsService,
    configService,
    userId,
    userRole,
    organizationId,
  );

  console.log('\n---\n');

  // Then draft response
  // Note: The sentiment result structure depends on LangChain's implementation
  // You can extract the sentiment from the result if needed
  const response = await testResponseAgent(
    ticketId,
    ticketsService,
    threadsService,
    configService,
    userId,
    userRole,
    organizationId,
  );

  return { sentiment, response };
}

