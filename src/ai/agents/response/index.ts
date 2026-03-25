import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { AIModelFactory } from '../../ai-model.factory';
import { SmartCacheService } from '../../smart-cache.service';
import { AiUsageService } from '../../telemetry/ai-usage.service';
import {
  HumanMessage,
  AIMessage,
  BaseMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { buildSystemPrompt } from '../common/prompts';
import { getAgentTools } from '../common/tools.factory';
import { runReActAgent, AgentResponse } from '../common/react-executor';

export { buildSystemPrompt };
export type { AgentResponse };

export const draftResponse = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: any, // KnowledgeBaseService
  customersService: any, // CustomersService
  userId: string,
  userRole: UserRole,
  organizationId: string,
  smartCacheService?: SmartCacheService,
  additionalContext?: string,
  channel?: string,
  isWaitingForNewTopicCheck = false,
): Promise<AgentResponse> => {
  const totalStart = Date.now();
  console.log(`[ReAct Agent] Started for ticket ${ticket_id}`);

  // 1. Fetch Context
  const [ticket, org] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    organizationsService.findOne(organizationId),
  ]);

  if (!ticket || !org) {
    throw new Error('Ticket or Organization not found');
  }

  const threads = await threadsService.findAll(
    ticket_id,
    organizationId,
    userId,
    userRole,
  );
  const threadsWithMessages = await Promise.all(
    threads.map(async (thread) => {
      const messages = await threadsService.getMessages(
        thread._id.toString(),
        organizationId,
        userId,
        userRole,
        undefined,
        10,
      );
      return { ...thread.toObject(), messages };
    }),
  );

  const allMessages = threadsWithMessages
    .flatMap((t) => t.messages)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  const recentMessages = allMessages.slice(-3);
  const lastCustomerMessage = [...recentMessages]
    .reverse()
    .find((m) => m.authorType === 'customer');
  const lastUserMessage = recentMessages[recentMessages.length - 1];

  // 2. Resolve Tools
  const allowedTools = getAgentTools({
    organizationId,
    userId,
    userRole,
    ticket,
    ticketsService,
    threadsService,
    knowledgeBaseService,
    customersService,
    channel,
  }).filter((t: any) => {
    // 1. Check organization restriction
    if (t.enabledForOrgs && !t.enabledForOrgs.includes(organizationId)) {
      return false;
    }

    return true;
  });

  const systemPrompt = buildSystemPrompt(
    org,
    channel,
    (ticket.customerId as any).firstName,
    allowedTools,
  );

  // 3. SMART CACHE CHECK
  if (
    smartCacheService &&
    lastCustomerMessage &&
    (!lastCustomerMessage.attachments ||
      lastCustomerMessage.attachments.length === 0)
  ) {
    const cacheResult = await smartCacheService.findMatch(
      lastCustomerMessage.content,
      organizationId,
    );

    if (
      cacheResult.type !== 'NONE' &&
      cacheResult.response &&
      (cacheResult.type === 'LITERAL' || (cacheResult.score || 1) >= 0.92)
    ) {
      const customerName = (ticket.customerId as any).firstName || 'Customer';
      const personalizedContent = await smartCacheService.personalize(
        cacheResult.response,
        { name: customerName },
        lastCustomerMessage.content,
      );

      AiUsageService.logUsageAndDeduct({
        feature: 'smart-cache',
        provider: 'cache',
        modelName: 'smart-cache',
        inputTokens: 0,
        outputTokens: 0,
        performanceMs: Date.now() - totalStart,
        cacheHit: true,
        cacheType: cacheResult.type,
        metadata: {
          type: 'smart-cache-decision',
          score: cacheResult.score,
          ticketId: ticket_id,
        },
      });

      return {
        action: 'REPLY',
        content: personalizedContent,
        confidence: 100,
        metadata: {
          tokenUsage: {},
          knowledgeBaseUsed: true,
          performanceMs: Date.now() - totalStart,
          toolCalls: [`smart_cache_${cacheResult.type.toLowerCase()}`],
        },
      };
    }
  }

  // 4. Intent Classification Check
  let requestComplexity: 'SIMPLE' | 'COMPLEX' = 'COMPLEX';
  if (lastCustomerMessage) {
    const latestText = lastCustomerMessage.content.trim().toLowerCase();
    const gratitudeRegex =
      /^(thanks?(\s+you)?|thank\s+you(\s+(so|very)\s+much)?|thx|ty|cheers|appreciated?|great\s+thanks?|ok\s+thanks?|perfect\s+thanks?|wonderful\s+thanks?)[\s!.]*$/i;
    const closureRegex =
      /^(bye|goodbye|good\s*bye|see\s+you|take\s+care|have\s+a\s+(good|nice|great)\s+(day|one|evening)|that'?s?\s+(all|it)|nothing\s+(else|more)|no\s+thanks?|i'?m?\s+good)[\s!.]*$/i;
    const resolutionRegex =
      /^(i\s+(just\s+)?saw\s+it|it('?s|\s+has)\s+(reflect|work|show|appear|come\s+through|gone\s+through|been\s+fix|been\s+resolv|been\s+sort|clear)|i\s+(can\s+)?see\s+(it|them|my)\s+now|it('?s)?\s+(fix|resolv|sort|work|fine|ok|good|done|back)\s*(ed|ing|now)?|problem\s+(solv|fix|resolv)|issue\s+(solv|fix|resolv)|never\s*mind|nvm|got\s+it|found\s+it|all\s+(good|sorted|resolved|fixed)|already\s+(reflect|work|show|appear|seen|receiv))[\s!.,]*$/i;

    if (
      gratitudeRegex.test(latestText) ||
      closureRegex.test(latestText) ||
      resolutionRegex.test(latestText)
    ) {
      return {
        action: 'AUTO_RESOLVE',
        content: '',
        confidence: 100,
        metadata: {
          tokenUsage: {},
          knowledgeBaseUsed: false,
          performanceMs: Date.now() - totalStart,
          toolCalls: ['intent_check_fast'],
        },
      };
    }

    // Simplified intent check for internal draft logic
    const flashModel = AIModelFactory.create(configService, {
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
    });

    try {
      const intentResp = await flashModel.invoke([
        new HumanMessage(
          `Classify intent and complexity (SIMPLE/COMPLEX) for: "${lastCustomerMessage.content}". Reply: INTENT|COMPLEXITY`,
        ),
      ]);
      const raw = (
        typeof intentResp.content === 'string' ? intentResp.content : ''
      ).toUpperCase();
      if (
        raw.includes('GRATITUDE') ||
        raw.includes('CLOSURE') ||
        raw.includes('RESOLUTION')
      ) {
        return {
          action: 'AUTO_RESOLVE',
          content: '',
          confidence: 100,
          metadata: {
            tokenUsage: intentResp.usage_metadata,
            knowledgeBaseUsed: false,
            performanceMs: Date.now() - totalStart,
            toolCalls: ['intent_check'],
          },
        };
      }
      requestComplexity = raw.includes('SIMPLE') ? 'SIMPLE' : 'COMPLEX';
    } catch (e) {
      console.error('Intent check failed', e);
    }
  }

  // 5. Build Messages & Run ReAct Agent
  const fetchMediaAsBase64 = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (e) {
      return null;
    }
  };

  const historyMessages: BaseMessage[] = [];
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    const isVeryRecent = i >= recentMessages.length - 3;
    const role = msg.authorType === 'customer' ? 'user' : 'assistant';
    const contentParts: any[] = [];
    const textContent = (msg.content || '').slice(0, 800);
    if (textContent) contentParts.push({ type: 'text', text: textContent });

    if (msg.attachments && msg.attachments.length > 0 && isVeryRecent) {
      for (const att of msg.attachments) {
        if (
          att.path?.startsWith('http') &&
          (att.mimeType?.startsWith('image/') ||
            att.mimeType?.startsWith('audio/') ||
            att.mimeType?.startsWith('video/'))
        ) {
          const base64Data = await fetchMediaAsBase64(att.path);
          if (base64Data) {
            if (att.mimeType.startsWith('image/')) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: base64Data },
              });
            } else {
              contentParts.push({
                type: 'media',
                mimeType: att.mimeType,
                data: base64Data.split(',')[1],
              });
            }
          }
        }
      }
    }
    if (contentParts.length === 0)
      contentParts.push({ type: 'text', text: '[Empty]' });
    historyMessages.push(
      role === 'user'
        ? new HumanMessage({ content: contentParts })
        : new AIMessage({ content: contentParts }),
    );
  }

  const issueContext = (ticket.summary || ticket.description || '').slice(
    0,
    500,
  );
  let prefetchedKBContext = '';
  let kbUsed = false;

  if (knowledgeBaseService && lastUserMessage?.authorType === 'customer') {
    const kbQuery = (lastUserMessage.content || '').slice(0, 500);
    prefetchedKBContext = await knowledgeBaseService
      .retrieveRelevantContent(kbQuery, organizationId, 3)
      .catch(() => '');
    if (prefetchedKBContext) {
      prefetchedKBContext = prefetchedKBContext.slice(0, 3000);
      kbUsed = true;
    }
  }

  const contextInstruction = `
Ticket Context:
- ID: ${ticket.displayId || ticket._id}
- Subject: ${ticket.subject}
- Summary: ${issueContext}

${prefetchedKBContext ? `# KB CONTEXT:\n${prefetchedKBContext}` : ''}
${additionalContext ? `Note: ${additionalContext}` : ''}
`;

  return runReActAgent({
    messages: [
      new SystemMessage(systemPrompt),
      ...historyMessages,
      new HumanMessage(contextInstruction),
    ],
    tools: allowedTools,
    mainModel: AIModelFactory.create(configService, {
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
    }), // Using flash as default per original logic
    fastModel: AIModelFactory.create(configService, {
      provider: 'vertex',
      model: 'gemini-3-flash-preview',
    }),
    requestComplexity,
    totalStart,
    kbUsed,
    smartCacheService,
    lastUserMessage,
    organizationId,
  });
};
