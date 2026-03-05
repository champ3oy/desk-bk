import { AIModelFactory } from '../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../../organizations/organizations.service';
import { buildSystemPrompt } from './common/prompts';
import { KnowledgeBaseService } from '../knowledge-base.service';
import { CustomersService } from '../../customers/customers.service';
import { TicketsService } from '../../tickets/tickets.service';
import { ThreadsService } from '../../threads/threads.service';
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { getAgentTools } from './common/tools.factory';
import { runReActAgent } from './common/react-executor';

export const playgroundChat = async (
  message: string,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: KnowledgeBaseService,
  customersService: CustomersService,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  organizationId: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  provider?: string,
  modelName?: string,
  customerEmail?: string,
  userId?: string,
  userRole?: any,
) => {
  const totalStart = Date.now();
  console.log(`[PERF] playgroundChat started`);

  // 1. Fetch Context
  const [org, customer] = await Promise.all([
    organizationsService.findOne(organizationId),
    customerEmail
      ? customersService.findByEmail(customerEmail, organizationId)
      : Promise.resolve(null),
  ]);

  // 2. Resolve Tools
  const allowedTools = getAgentTools({
    organizationId,
    userId: userId || organizationId, // Fallback to orgId for system actions
    userRole: userRole || 'admin',
    ticket: null, // No real ticket in playground
    customerId: (customer as any)?._id?.toString(),
    ticketsService,
    threadsService,
    knowledgeBaseService,
    customersService,
  });

  const systemPrompt = buildSystemPrompt(
    org,
    'chat',
    customer ? `${customer.firstName} ${customer.lastName}` : undefined,
    allowedTools,
  );

  // Add Mini Agent instructions for customer extraction if not identified
  let enhancedPrompt = systemPrompt;
  if (!customer) {
    enhancedPrompt += `\n\nOBJECTIVE: Identify the user. If they provide name/email, extract it: [[CUSTOMER_INFO: {"firstName": "...", "lastName": "...", "email": "..."}]] at the start of your message.`;
  }

  // 3. Build Messages
  const messages: BaseMessage[] = [new SystemMessage(enhancedPrompt)];

  if (history && history.length > 0) {
    messages.push(
      ...history
        .filter((msg) => msg.content && msg.content.trim() !== '')
        .map((msg) =>
          msg.role === 'user'
            ? new HumanMessage(msg.content)
            : new AIMessage(msg.content),
        ),
    );
  }

  messages.push(new HumanMessage(message));

  // 4. Run Agent
  const result = await runReActAgent({
    messages,
    tools: allowedTools,
    mainModel: AIModelFactory.create(configService, {
      provider,
      model: modelName,
    }),
    fastModel: AIModelFactory.create(configService, {
      provider,
      model: modelName,
    }),
    requestComplexity: 'COMPLEX', // Default to full capability for playground
    totalStart,
    kbUsed: false,
    organizationId,
  });

  // Handle customer extraction from final content if prompt added it
  let detectedCustomer = customer;
  let finalContent = result.content || '';

  const extractionRegex = /\[\[CUSTOMER_INFO: ({.*?})\]\]/s;
  const match = finalContent.match(extractionRegex);
  if (match && match[1]) {
    try {
      const extractedData = JSON.parse(match[1]);
      finalContent = finalContent.replace(match[0], '').trim();
      if (extractedData.email && !customer) {
        detectedCustomer = await customersService.findOrCreate(
          extractedData,
          organizationId,
        );
      }
    } catch (e) {
      console.error('[Playground] Failed to parse extracted info', e);
    }
  }

  return {
    content: finalContent,
    customer: detectedCustomer,
    performanceMs: Date.now() - totalStart,
  };
};
