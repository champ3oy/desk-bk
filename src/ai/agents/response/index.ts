import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';
import { AIModelFactory } from '../../ai-model.factory';

const DEFAULT_SYSTEM_PROMPT = `You are an expert customer support agent for our company. Your role is to draft professional, empathetic, and helpful responses to customers.

# KNOWLEDGE BASE INSTRUCTIONS
- You will be provided with relevant context from our knowledge base.
- ALWAYS prioritize information from the knowledge base over your general training.
- If the knowledge base contains the answer, use it to solve the customer's problem.
- If the knowledge base does not contain the answer, perform a generic helpful response but politely admit if you are unsure about company-specific policies that aren't in the knowledge base.
- Cite specific policies or guides if they appear in the knowledge base context.

# INTERNAL AGENT PERSONA (CRITICAL)
- You ARE the company. Speak with authority and ownership.
- NEVER say "According to our records", "According to our resources", "Based on the knowledge base", or similar phrases.
- Present information as facts you know.
- BAD: "According to our resources, the EEBF is a fund..."
- GOOD: "The EEBF is a fund..."
- BAD: "Our records show that refunds take 5 days."
- GOOD: "Refunds typically process within 5 days."

# GENERAL GUIDELINES
- Be clear, concise, and professional
- Show empathy and understanding
- Address the customer's concerns directly
- Provide actionable solutions when possible
- Match the tone to the customer's sentiment
- Use appropriate language for the communication channel
- Ensure the response is appropriate for the ticket context and conversation history
- Consider all threads and messages in the ticket to understand the full context

# GREETINGS & SHORT MESSAGES (IMPORTANT)
- If the customer message is just a greeting (e.g., "Hello", "Hi") or very short:
  - Keep your response brief (maximum 2-3 sentences).
  - Friendly greeting + "How can I help you today?"
  - Do NOT assume they have a specific problem yet.
  - Do NOT list products, services, or financial advice unless asked.
  - Do NOT use the Knowledge Base content if it is unrelated to a greeting.

# RESPONSE FORMATTING
- Output ONLY the message content.
- Do not add "Subject:" lines.
- Do not add "Dear Customer" placeholders if the name is known.
- Do not include "Explanation of Choices" or similar sections.`;

/**
 * Build a dynamic system prompt based on organization AI configuration
 */
export function buildSystemPrompt(org: Organization): string {
  // Use custom prompt if provided, otherwise use default
  let basePrompt = org.aiPersonalityPrompt || DEFAULT_SYSTEM_PROMPT;

  const toneInstructions: string[] = [];

  // Formality (0-100)
  if (org.aiFormality !== undefined) {
    if (org.aiFormality < 30) {
      toneInstructions.push('- Use casual, conversational language');
      toneInstructions.push('- Feel free to use contractions naturally');
    } else if (org.aiFormality > 70) {
      toneInstructions.push(
        '- Maintain formal, professional tone at all times',
      );
      toneInstructions.push(
        '- Avoid contractions (use "do not" instead of "don\'t")',
      );
      toneInstructions.push('- Use complete sentences and proper grammar');
    }
  }

  // Empathy (0-100)
  if (org.aiEmpathy !== undefined && org.aiEmpathy > 70) {
    toneInstructions.push('- Show high empathy and emotional understanding');
    toneInstructions.push(
      '- Acknowledge customer feelings before problem-solving',
    );
    toneInstructions.push(
      '- Use empathetic language like "I understand how frustrating this must be"',
    );
  }

  // Response length (0-100)
  if (org.aiResponseLength !== undefined) {
    if (org.aiResponseLength < 30) {
      toneInstructions.push('- Keep responses brief and concise');
      toneInstructions.push('- Get straight to the point');
    } else if (org.aiResponseLength > 70) {
      toneInstructions.push('- Provide detailed, comprehensive responses');
      toneInstructions.push('- Include thorough explanations and context');
    }
  }

  // Emojis
  if (org.aiUseEmojis) {
    toneInstructions.push(
      '- Use appropriate emojis to convey warmth and friendliness (✨, 😊, 👍, 🎉)',
    );
  } else {
    toneInstructions.push('- Do not use emojis in responses');
  }

  // Greetings
  if (org.aiIncludeGreetings === false) {
    toneInstructions.push(
      '- Skip greetings, get straight to addressing the issue',
    );
  } else {
    toneInstructions.push('- Start with friendly greetings');
  }

  // Sign-off
  if (org.aiIncludeSignOff === false) {
    toneInstructions.push('- Skip sign-offs, end with the solution');
  }

  // Vocabulary preferences
  if (org.aiWordsToUse) {
    toneInstructions.push(`- Prefer using these phrases: ${org.aiWordsToUse}`);
  }
  if (org.aiWordsToAvoid) {
    toneInstructions.push(`- Avoid using these phrases: ${org.aiWordsToAvoid}`);
  }

  // Combine everything
  if (toneInstructions.length > 0) {
    return `${basePrompt}\n\n# TONE GUIDELINES\n${toneInstructions.join('\n')}`;
  }

  return basePrompt;
}

export const draftResponse = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: any, // KnowledgeBaseService
  userId: string,
  userRole: UserRole,
  organizationId: string,
  additionalContext?: string,
) => {
  const totalStart = Date.now();
  console.log(`[PERF] draftResponse started for ticket ${ticket_id}`);

  // ========== PARALLELIZED DATA FETCHING ==========
  // Fetch ticket, organization, and threads in parallel to reduce latency
  const parallelStart = Date.now();

  const [ticket, org, threads] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    organizationsService.findOne(organizationId),
    threadsService.findAll(ticket_id, organizationId, userId, userRole),
  ]);

  console.log(
    `[PERF] Parallel fetch (ticket + org + threads): ${Date.now() - parallelStart}ms`,
  );

  // Fetch messages for all threads in parallel
  const messagesStart = Date.now();
  const threadsWithMessages = await Promise.all(
    threads.map(async (thread) => {
      const messages = await threadsService.getMessages(
        thread._id.toString(),
        organizationId,
        userId,
        userRole,
      );
      return {
        ...thread.toObject(),
        messages: messages.map((msg) => msg.toObject()),
      };
    }),
  );
  console.log(
    `[PERF] Fetch messages for ${threads.length} threads: ${Date.now() - messagesStart}ms`,
  );

  // ========== KNOWLEDGE BASE RETRIEVAL (can run in parallel with message fetch) ==========
  let knowledgeContext = '';
  if (knowledgeBaseService) {
    try {
      const kbStart = Date.now();
      const query = `${ticket.subject} ${ticket.description}`;
      knowledgeContext = await knowledgeBaseService.retrieveRelevantContent(
        query,
        organizationId,
        3, // Max 3 relevant documents
      );
      console.log(`[PERF] Knowledge base retrieval: ${Date.now() - kbStart}ms`);
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
    }
  }

  // ========== BUILD SYSTEM PROMPT ==========
  const systemPrompt = buildSystemPrompt(org);

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService);
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // ========== BUILD CONTEXT WITH PRE-FETCHED DATA ==========
  // Instead of having the agent call a tool to fetch ticket data (which causes duplicate fetches),
  // we include all the data directly in the prompt
  const ticketData = {
    ticket: ticket.toObject(),
    threads: threadsWithMessages,
  };

  let contextPrompt = `# TICKET DATA
Here is the complete ticket information with all threads and messages:

## Ticket Details
- ID: ${ticketData.ticket._id}
- Subject: ${ticketData.ticket.subject}
- Description: ${ticketData.ticket.description}
- Status: ${ticketData.ticket.status}
- Priority: ${ticketData.ticket.priority}
- Created: ${ticketData.ticket.createdAt}

## Conversation History
${threadsWithMessages
  .map(
    (thread, idx) => `
### Thread ${idx + 1}
${thread.messages.map((msg: any) => `[${msg.messageType === 'external' ? 'Customer' : 'Agent'}] ${msg.content}`).join('\n\n')}
`,
  )
  .join('\n')}

# TASK
${
  additionalContext
    ? `Draft a response for this ticket. Additional context: ${additionalContext}`
    : `Draft a professional response for this ticket. Consider all threads, messages, ticket details, conversation history, and customer sentiment.`
}

# OUTPUT FORMAT
- Provide ONLY the draft text that should be sent to the customer.
- Do NOT include "Here is a draft", "Okay", "Explanation:", or any other meta-text.
- Do NOT include internal monologue or reasoning.
- Do NOT include Markdown headers for the response itself (unless the response requires it).
- Act directly as the agent responding to the customer.`;

  // Add knowledge base context if available
  if (knowledgeContext) {
    contextPrompt += `\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information from our knowledge base to inform your response:\n\n${knowledgeContext}`;
  }

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();
  let response;

  try {
    response = await model.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextPrompt },
    ]);
  } catch (error) {
    console.error('[AI Agent] LLM Invocation Failed:', error);
    const isRateLimit =
      error.status === 429 || (error.message && error.message.includes('429'));

    const errorMessage = isRateLimit
      ? 'I cannot draft a response right now due to high traffic (Google rate limit). Please try again in 1 minute.'
      : 'I encountered an error while drafting the response. Please check logs.';

    // Return error as content so UI shows it
    return {
      content: errorMessage,
      metadata: {
        tokenUsage: {},
        knowledgeBaseUsed: !!knowledgeContext,
        performanceMs: Date.now() - totalStart,
      },
    };
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract content
  const content = response.content;
  const responseContent =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  console.log(`[PERF] TOTAL draftResponse: ${Date.now() - totalStart}ms`);

  return {
    content: responseContent,
    metadata: {
      tokenUsage:
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      knowledgeBaseUsed: !!knowledgeContext,
      performanceMs: Date.now() - totalStart,
    },
  };
};
