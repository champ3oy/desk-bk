import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';
import { AIModelFactory } from '../../ai-model.factory';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

const DRAFT_SYSTEM_PROMPT = `You are an AI assistant helping a human customer support agent draft a response to a customer.

# YOUR ROLE
- You are ASSISTING a human agent, not replacing them
- Provide a helpful, professional draft that the agent can review, edit, and send
- The agent will review and potentially modify your draft before sending

# RESPONSE GUIDELINES
- Write a clear, helpful response that addresses the customer's issue
- Be professional, empathetic, and solution-oriented
- Match the tone to the customer's sentiment
- Keep the response focused and actionable
- DO NOT make decisions about escalation - the human agent will handle that
- ALWAYS provide a proactive draft. Avoid using phrases like "I cannot" or "I am unable to." Instead, explain what is being done or what information is needed to proceed.

# KNOWLEDGE BASE
- You will be provided with relevant context from the knowledge base
- Use this information to inform your response
- NEVER say "According to our records" or "Based on the knowledge base"
- Present information naturally as if you're the company representative

# FORMATTING
- NEVER include sign-offs like "Best regards", "Sincerely", etc.
- NEVER include agent names or signatures
- End your response after providing the solution or next steps
- Do not use any markdown formatting
- Signatures are handled separately by the system

# OUTPUT FORMAT
You must output ONLY a plain text response. Do not use JSON or any special formatting.
Just write the message that should be sent to the customer.

# INTERNAL PROGRESS & TEAM COORDINATION
- You will see internal notes and comments. Treat these as the "behind-the-scenes" progress of the ticket.
- Use these notes to provide the customer with accurate updates on the status of their request.
- Refer to the "team" generally unless a specific department is mentioned in a note.
- DO NOT invent internal actions (e.g., do not say "I have flagged this for Finance") if there is no corresponding internal note or tool action.

# IMAGES
If images (screenshots) are provided in the context, you MUST use the information from them (error messages, codes, visual details) to provide a more accurate and helpful response.`;

/**
 * Build a system prompt for drafting human responses based on organization settings
 */
function buildDraftSystemPrompt(
  org: Organization,
  channel?: string,
  customerName?: string,
): string {
  const prompt = DRAFT_SYSTEM_PROMPT;

  const toneInstructions: string[] = [];

  // Formality (0-100)
  if (org.aiFormality !== undefined) {
    if (org.aiFormality < 30) {
      toneInstructions.push('- Use casual, conversational language');
      toneInstructions.push('- Feel free to use contractions naturally');
    } else if (org.aiFormality > 70) {
      toneInstructions.push('- Maintain formal, professional tone');
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
  if (org.aiIncludeGreetings === false && channel !== 'email') {
    toneInstructions.push(
      '- Skip greetings, get straight to addressing the issue',
    );
  } else {
    if (channel === 'email' && customerName) {
      toneInstructions.push(`- Start the email with "Dear ${customerName},"`);
    } else {
      toneInstructions.push('- Start with a friendly greeting');
    }
  }

  // Sign-off - IMPORTANT: Never include signatures/sign-offs in live chat or social media
  // Email signatures are handled separately by the system
  if (channel === 'email') {
    toneInstructions.push(
      '- End the email with a closing like "Best regards,"',
    );
    toneInstructions.push(
      '- Do NOT add a signature block, name, or company name (it is appended automatically)',
    );
  } else {
    toneInstructions.push(
      '- NEVER include sign-offs, signatures, or "Best regards" type endings',
    );
    toneInstructions.push(
      '- End responses with the solution or next steps only',
    );
    toneInstructions.push(
      '- Do NOT add "Best regards", "Sincerely", agent names, or company names at the end',
    );
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
    return `${prompt}\n\n# TONE GUIDELINES\n${toneInstructions.join('\n')}`;
  }

  return prompt;
}

export type DraftHumanResponseResult = {
  content: string;
  metadata: {
    tokenUsage: any;
    knowledgeBaseUsed: boolean;
    performanceMs: number;
  };
};

/**
 * Draft a response for a human agent to review and send
 * This is simpler than the auto-reply function - it just generates a helpful draft
 * without making decisions about escalation
 */
export const draftHumanResponse = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: any,
  userId: string,
  userRole: UserRole,
  organizationId: string,
  additionalContext?: string,
  channel?: string,
): Promise<DraftHumanResponseResult> => {
  const totalStart = Date.now();

  // ========== FETCH DATA IN PARALLEL ==========
  const parallelStart = Date.now();

  const [ticket, org, threads, comments] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    organizationsService.findOne(organizationId),
    threadsService.findAll(ticket_id, organizationId, userId, userRole),
    commentsService.findAll(ticket_id, userId, userRole),
  ]);

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
        messages: messages,
      };
    }),
  );

  // ========== KNOWLEDGE BASE RETRIEVAL ==========
  let knowledgeContext = '';
  if (knowledgeBaseService) {
    try {
      // Get the latest customer message (the "now" problem)
      const lastCustomerMsg =
        threadsWithMessages
          .flatMap((t) => t.messages)
          .filter((m) => m.authorType === 'customer')
          .sort(
            (a, b) =>
              new Date(b.createdAt || 0).getTime() -
              new Date(a.createdAt || 0).getTime(),
          )[0]?.content || '';

      // Get the latest internal note (the "behind the scenes" progress)
      const lastInternalNote =
        comments
          ?.filter((c: any) => c.isInternal)
          .sort(
            (a, b) =>
              new Date(b.createdAt || 0).getTime() -
              new Date(a.createdAt || 0).getTime(),
          )[0]?.content || '';

      // Build a dynamic query that prioritizes current context
      const query = `
        Subject: ${ticket.subject} 
        Current User Issue: ${lastCustomerMsg} 
        Internal Note: ${lastInternalNote}
      `.trim();

      knowledgeContext = await knowledgeBaseService.retrieveRelevantContent(
        query,
        organizationId,
        4, // Max 4 relevant documents for Pro model reasoning
      );
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
    }
  }

  // ========== BUILD SYSTEM PROMPT ==========
  const customerName =
    typeof ticket.customerId === 'object' && 'firstName' in ticket.customerId
      ? (ticket.customerId as any).firstName
      : undefined;

  const systemPrompt = buildDraftSystemPrompt(org, channel, customerName);

  // ========== MODEL INITIALIZATION ==========
  const model = AIModelFactory.create(configService, {
    provider: 'vertex',
    model: 'gemini-3-flash-preview',
  });

  // ========== BUILD CONTEXT ==========
  const ticketData = {
    ticket: ticket.toObject(),
  };

  // Optimization: Prune conversation history to last 20 messages for context
  const allMessages = threadsWithMessages
    .flatMap((t) => t.messages)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  const totalMessageCount = allMessages.length;
  const prunedMessages = allMessages.slice(-20); // Last 20 is plenty for a draft

  let contextPrompt = `# TICKET DATA
Here is the ticket information and recent conversation history:

## Ticket Details
- ID: ${ticketData.ticket._id}
- Subject: ${ticketData.ticket.subject}
- Description: ${ticketData.ticket.description}
- Status: ${ticketData.ticket.status}
- Priority: ${ticketData.ticket.priority}
- Summary of Issue: ${ticketData.ticket.summary || ticketData.ticket.description || 'No summary available.'}

## Recent Conversation History ${totalMessageCount > 20 ? `(Showing last 20 of ${totalMessageCount} messages)` : ''}
${prunedMessages
  .map(
    (
      msg: any,
    ) => `[${msg.authorType === 'customer' ? 'Customer' : 'Agent'}] (${new Date(msg.createdAt).toLocaleString()})
${msg.content}${msg.attachments
      ?.filter((a: any) => a.aiDescription)
      .map((a: any) => `\n[ATTACHMENT SUMMARY: ${a.aiDescription}]`)
      .join('')}`,
  )
  .join('\n\n')}

## Team Coordination & Progress (Internal Notes)
${
  comments && comments.length > 0
    ? comments
        .map(
          (comment: any) =>
            `[${comment.isInternal ? 'Internal Progress' : 'Public Update'}] ${comment.content}`,
        )
        .join('\n')
    : 'No internal coordination notes yet.'
}

# TASK
Draft a helpful response for the human agent to send to the customer.${
    additionalContext ? ` Additional context: ${additionalContext}` : ''
  }
`;

  // Add knowledge base context if available
  if (knowledgeContext) {
    contextPrompt += `\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information from our knowledge base to inform your response:\n\n${knowledgeContext}`;
  }

  // ========== PREPARE IMAGES FOR AI CONTEXT ==========
  const imageContents: any[] = [];
  try {
    // Only fetch raw binary images for the very recent interactions (last 3 messages)
    // For anything older, we rely on the [ATTACHMENT SUMMARY] already included in the text context above
    const recentMessagesForImages = prunedMessages.slice(-3);

    for (const msg of recentMessagesForImages) {
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          const mime = att.mimeType || att.mime_type || att.mimetype;
          if (
            mime &&
            mime.startsWith('image/') &&
            att.path?.startsWith('http')
          ) {
            try {
              const res = await fetch(att.path);
              if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                imageContents.push({
                  type: 'image',
                  source_type: 'base64',
                  mime_type: mime,
                  data: Buffer.from(arrayBuffer).toString('base64'),
                });
              }
            } catch (e) {
              console.warn(
                `Failed to fetch recent image for draft: ${att.path}`,
                e,
              );
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('Error processing images for AI draft:', e);
  }

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();
  let response;

  try {
    const userMessageContent: any[] = [{ type: 'text', text: contextPrompt }];

    // Inject images if available
    if (imageContents.length > 0) {
      console.log(
        `[AI Draft] Injecting ${imageContents.length} images into prompt`,
      );
      imageContents.forEach((img) => {
        userMessageContent.push({
          type: 'image',
          source_type: 'base64',
          mime_type: img.mime_type,
          data: img.data,
        });
      });
    }

    response = await (model as any).invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: userMessageContent,
      }),
    ]);
  } catch (error) {
    console.error('[AI Agent] LLM Invocation Failed:', error);
    throw new Error('Failed to generate draft response');
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract content
  let responseText = '';
  try {
    const content = response.content;
    responseText =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((item: any) =>
                typeof item === 'string' ? item : item.text || '',
              )
              .join('')
          : '';
  } catch (e) {
    console.error('Failed to extract response content:', e);
    throw new Error('Failed to parse AI response');
  }

  console.log(`[PERF] TOTAL draftHumanResponse: ${Date.now() - totalStart}ms`);

  return {
    content: responseText.trim(),
    metadata: {
      tokenUsage:
        response?.usage_metadata || response?.response_metadata?.tokenUsage,
      knowledgeBaseUsed: !!knowledgeContext,
      performanceMs: Date.now() - totalStart,
    },
  };
};
