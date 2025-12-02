# Testing AI Agents

This guide explains how to test the Response and Sentiment AI agents.

## Prerequisites

1. **Environment Variables**: Make sure you have your Gemini API key set up in your `.env` file:
   ```env
   GEMINI_API_KEY=your-api-key-here
   ```
   Or you can use `GOOGLE_API_KEY` as an alternative name. Get your API key from: https://aistudio.google.com/app/apikey

2. **Database**: Ensure your MongoDB database is running and has test data with:
   - At least one ticket
   - At least one thread associated with that ticket (the response agent will automatically fetch all threads)
   - Some messages in the thread(s)

## Testing Methods

### 1. Unit Tests (Jest)

Run the unit tests to verify the agent structure and service integration:

```bash
# Run all tests
npm test

# Run only agent tests
npm test -- response.spec.ts sentiment.spec.ts

# Run in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

**Note**: Unit tests mock the services but may still make actual API calls to the LLM. For true unit testing, you may want to mock the `agent.invoke` method as well.

### 2. Manual Testing via API Endpoint

Create a test controller or add endpoints to an existing controller:

```typescript
// Example: src/ai/ai.controller.ts
import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { draftResponse } from './agents/response';
import { analyzeSentiment } from './agents/sentiment';
import { TicketsService } from '../tickets/tickets.service';
import { ThreadsService } from '../threads/threads.service';
import { CommentsService } from '../comments/comments.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly threadsService: ThreadsService,
    private readonly commentsService: CommentsService,
  ) {}

  @Post('draft-response')
  async draftResponse(
    @Body() body: { ticketId: string; context?: string },
    @Request() req,
  ) {
    return await draftResponse(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
      body.context,
    );
  }

  @Post('analyze-sentiment')
  async analyzeSentiment(
    @Body() body: { ticketId: string },
    @Request() req,
  ) {
    return await analyzeSentiment(
      body.ticketId,
      this.ticketsService,
      this.threadsService,
      this.commentsService,
      req.user.userId,
      req.user.role,
      req.user.organizationId,
    );
  }
}
```

Then test with curl or Postman:

```bash
# Test sentiment analysis
curl -X POST http://localhost:3000/api/ai/analyze-sentiment \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketId": "your-ticket-id"}'

# Test response drafting
curl -X POST http://localhost:3000/api/ai/draft-response \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "your-ticket-id",
    "context": "Customer is a VIP member"
  }'
```

### 3. Direct Function Testing

You can import and test the functions directly in a NestJS service or script:

```typescript
import { testResponseAgent, testSentimentAgent, testBothAgents } from './ai/agents/test-agents';

// In your service method
async testAgents() {
  const ticketId = 'your-ticket-id';
  
  // Test sentiment
  const sentiment = await testSentimentAgent(
    ticketId,
    this.ticketsService,
    this.threadsService,
    this.commentsService,
    'user-id',
    UserRole.AGENT,
    'org-id',
  );

  // Test response
  const response = await testResponseAgent(
    ticketId,
    this.ticketsService,
    this.threadsService,
    'user-id',
    UserRole.AGENT,
    'org-id',
  );

  // Or test both together
  const results = await testBothAgents(
    ticketId,
    this.ticketsService,
    this.threadsService,
    this.commentsService,
    'user-id',
    UserRole.AGENT,
    'org-id',
  );
}
```

### 4. Using NestJS REPL

You can also test interactively using NestJS console:

```bash
# Start the app in development mode
npm run start:dev

# In another terminal, you can use the NestJS console
# Or create a temporary endpoint for testing
```

## Expected Results

### Sentiment Agent
Should return a structured analysis with:
- Primary sentiment (angry, sad, happy, frustrated, neutral, concerned, grateful, confused)
- Confidence level (high, medium, low)
- Explanation
- Key phrases/indicators

### Response Agent
Should return a drafted response that:
- Is professional and empathetic
- Addresses the customer's concerns
- Matches the conversation context
- Is appropriate for the communication channel

## Troubleshooting

1. **API Key Issues**: Make sure `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set correctly in your `.env` file
2. **Database Connection**: Ensure MongoDB is running and accessible
3. **Permissions**: Verify the user has access to the ticket/thread
4. **Network Issues**: Check your internet connection for LLM API calls
5. **Rate Limits**: Be aware of API rate limits when testing

## Mocking for Tests

For true unit tests without API calls, you can mock the LangChain agent:

```typescript
jest.mock('langchain', () => ({
  createAgent: jest.fn(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'Mocked response',
    }),
  })),
  tool: jest.fn((fn, config) => ({ fn, config })),
}));
```

