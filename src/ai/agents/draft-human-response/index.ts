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
- DO NOT refuse to help - always provide a draft response

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
  let prompt = DRAFT_SYSTEM_PROMPT;

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
  console.log(`[PERF] draftHumanResponse started for ticket ${ticket_id}`);

  // ========== FETCH DATA IN PARALLEL ==========
  const parallelStart = Date.now();

  const [ticket, org, threads, comments] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    organizationsService.findOne(organizationId),
    threadsService.findAll(ticket_id, organizationId, userId, userRole),
    commentsService.findAll(ticket_id, userId, userRole),
  ]);

  console.log(
    `[PERF] Parallel fetch (ticket + org + threads + comments): ${Date.now() - parallelStart}ms`,
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

  // ========== KNOWLEDGE BASE RETRIEVAL ==========
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
  const customerName =
    typeof ticket.customerId === 'object' && 'firstName' in ticket.customerId
      ? (ticket.customerId as any).firstName
      : undefined;

  const systemPrompt = buildDraftSystemPrompt(org, channel, customerName);

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService);
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // ========== BUILD CONTEXT ==========
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
${thread.messages
  .map(
    (
      msg: any,
    ) => `[${msg.authorType === 'customer' ? 'Customer' : 'Agent'}] (${new Date(msg.createdAt).toLocaleString()})
${msg.content}`,
  )
  .join('\n\n')}
`,
  )
  .join('\n')}

## Internal Comments
${
  comments && comments.length > 0
    ? comments
        .map(
          (comment: any) =>
            `[${comment.isInternal ? 'Internal' : 'Public'}] ${comment.content}`,
        )
        .join('\n')
    : 'No comments'
}

# TASK
Draft a helpful response for the human agent to send to the customer.${
    additionalContext ? ` Additional context: ${additionalContext}` : ''
  }

Remember: You are helping a human agent draft a response. Provide a clear, professional message that addresses the customer's needs. The agent will review and may edit your draft before sending.
`;

  // Add knowledge base context if available
  if (knowledgeContext) {
    contextPrompt += `\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information from our knowledge base to inform your response:\n\n${knowledgeContext}`;
  }

  // ========== PREPARE IMAGES FOR AI CONTEXT ==========
  // Extract images from messages to provide visual context
  const images: any[] = [];
  try {
    const base64Regex = /data:image\/([a-zA-Z+]*);base64,([^"'\s>]+)/g;
    const urlRegex =
      /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?)/gi;

    // Scan ticket description and raw body for images
    const ticketSearchContent =
      (ticketData.ticket.description || '') + (ticketData.ticket.rawBody || '');

    let tMatch;
    while ((tMatch = base64Regex.exec(ticketSearchContent)) !== null) {
      images.push({
        mimeType: `image/${tMatch[1] === 'jpeg' ? 'jpeg' : tMatch[1] || 'png'}`,
        base64Data: tMatch[2],
        isBase64: true,
        filename: 'ticket_embedded_image',
      });
    }

    const tUrls = ticketSearchContent.match(urlRegex);
    if (tUrls) {
      tUrls.forEach((url: string) => {
        images.push({
          path: url,
          mimeType: url.toLowerCase().endsWith('.png')
            ? 'image/png'
            : 'image/jpeg',
          filename: 'ticket_url_image',
        });
      });
    }

    console.log(
      `[AI Draft] Scanning ${threadsWithMessages.length} threads for images...`,
    );
    threadsWithMessages.forEach((thread: any, tIdx: number) => {
      if (thread.messages && Array.isArray(thread.messages)) {
        thread.messages.forEach((msg: any, mIdx: number) => {
          if (msg.attachments && msg.attachments.length > 0) {
            msg.attachments.forEach((att: any) => {
              const mime = att.mimeType || att.mime_type || att.mimetype;
              if (mime && mime.startsWith('image/')) {
                if (att.path) {
                  images.push({ ...att, mimeType: mime });
                } else if (att.base64 || att.data) {
                  images.push({
                    mimeType: mime,
                    base64Data: att.base64 || att.data,
                    isBase64: true,
                    filename: att.filename || 'attachment_image',
                  });
                }
              }
            });
          }

          // Check for base64 images in rawBody or content
          const msgSearchContent = (msg.rawBody || '') + (msg.content || '');
          let bMatch;
          while ((bMatch = base64Regex.exec(msgSearchContent)) !== null) {
            images.push({
              mimeType: `image/${bMatch[1] === 'jpeg' ? 'jpeg' : bMatch[1] || 'png'}`,
              base64Data: bMatch[2],
              isBase64: true,
              filename: 'embedded_image',
            });
          }

          const foundUrls = msgSearchContent.match(urlRegex);
          if (foundUrls) {
            foundUrls.forEach((url: string) => {
              if (!images.find((img) => img.path === url)) {
                images.push({
                  path: url,
                  mimeType: url.toLowerCase().endsWith('.png')
                    ? 'image/png'
                    : 'image/jpeg',
                  filename: 'url_image',
                });
              }
            });
          }
        });
      }
    });
  } catch (e) {
    console.warn('Error extracting images for AI draft:', e);
  }

  // Take most recent 3 images
  const recentImages = images.slice(-3);
  const imageContents: any[] = [];

  if (recentImages.length > 0) {
    console.log(
      `[AI Draft] Fetching ${recentImages.length} images for context...`,
    );
    await Promise.all(
      recentImages.map(async (img) => {
        try {
          let base64Data = '';
          if (img.isBase64) {
            base64Data = img.base64Data;
          } else if (
            typeof img.path === 'string' &&
            img.path.startsWith('http')
          ) {
            const res = await fetch(img.path);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              base64Data = Buffer.from(arrayBuffer).toString('base64');
            }
          }

          if (base64Data) {
            imageContents.push({
              type: 'image',
              source_type: 'base64',
              mime_type: img.mimeType,
              data: base64Data,
            });
          }
        } catch (e) {
          console.error(`Failed to fetch image for AI draft: ${img.path}`, e);
        }
      }),
    );
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
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      knowledgeBaseUsed: !!knowledgeContext,
      performanceMs: Date.now() - totalStart,
    },
  };
};
