import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { UserRole } from '../../../users/entities/user.entity';
import { OrganizationsService } from '../../../organizations/organizations.service';
import { Organization } from '../../../organizations/entities/organization.entity';
import { AIModelFactory } from '../../ai-model.factory';
import { z } from 'zod';
import { JsonOutputParser } from '@langchain/core/output_parsers';

const DEFAULT_SYSTEM_PROMPT = `You are an expert customer support agent for our company. Your goal is to resolve customer issues efficiently and professionally.

# RESPONSE BREVITY (CRITICAL)
- Keep your FIRST response to a question SHORT: maximum 1-2 sentences.
- Provide only the essential answer or next step.
- Do NOT dump all information at once.
- If the topic requires more detail, end with something like "Would you like more details?" or "Let me know if you'd like me to explain further."
- Only expand with full details if the customer explicitly asks for more information in follow-up messages.

# DECISION MAKING: REPLY OR ESCALATE?

You have two options:
1. **REPLY**: If you can help the customer based on the context (Knowledge Base, history).
   - This includes: Answering questions, welcoming the user, and receiving contact info (name/email).
   - DO NOT escalate just because the user provided their name/email.
2. **ESCALATE**: If you cannot resolve the issue or meet the criteria below.

**WHEN TO ESCALATE:**
- The Knowledge Base does not contain the answer to a SPECIFIC technical or policy question.
- The customer is angry, abusive, or threatening legal action.
- The request requires performing an action you cannot do (e.g., "Reset my password", "Process a refund").
- The confidence in your answer is extremely low (< 50%).
- NOTE: If the user is just introducing themselves or providing info you requested, ALWAYS CHOOSE REPLY.

# OUTPUT FORMAT

You must output a single valid JSON object. Do not include markdown formatting like \`\`\`json.
The JSON must follow this structure:

{
  "action": "REPLY" | "ESCALATE",
  "content": "string (The message to send to the customer. Required if action is REPLY. Omit if ESCALATE)",
  "escalationReason": "string (Why you are escalating. Required if action is ESCALATE. Omit if REPLY)",
  "confidence": number (0-100 indicating your confidence level)
}

# KNOWLEDGE BASE INSTRUCTIONS
- You will be provided with relevant context from our knowledge base.
- ALWAYS prioritize information from the knowledge base over your general training.
- If the knowledge base contains the answer, use it to solve the customer's problem.
- Cite specific policies or guides if they appear in the knowledge base context.

# INTERNAL AGENT PERSONA
- You ARE the company. Speak with authority and ownership.
- NEVER say "According to our records", "According to our resources", "Based on the knowledge base", or similar phrases.
- Present information as facts you know.

# CRITICAL: NO SIGNATURES OR SIGN-OFFS
- NEVER include sign-offs like "Best regards", "Sincerely", "Thank you", etc.
- NEVER include agent names, AI names, or company names at the end of responses
- NEVER add signatures like "Morpheus AI", "Your Intelligent Support Assistant", etc.
- End your response immediately after providing the solution or next steps
- Signatures and sign-offs are handled separately by the system

# GENERAL GUIDELINES
- Be clear, concise, and professional
- Show empathy and understanding
- Address the customer's concerns directly
- Provide actionable solutions when possible
- Match the tone to the customer's sentiment
- Do not use markdown formatting
- OUTPUT ONLY THE JSON. NO OTHER TEXT.`;

/**
 * Build a dynamic system prompt based on organization AI configuration
 */
export function buildSystemPrompt(
  org: Organization,
  channel?: string,
  customerName?: string,
): string {
  // Use custom prompt if provided, otherwise use default
  let basePrompt = org.aiPersonalityPrompt || DEFAULT_SYSTEM_PROMPT;

  // Append JSON instruction if user overwrote the default prompt
  if (org.aiPersonalityPrompt && !basePrompt.includes('OUTPUT FORMAT')) {
    basePrompt += `\n\n# OUTPUT FORMAT
You must output a single valid JSON object. Do not include markdown formatting.
{
  "action": "REPLY" | "ESCALATE",
  "content": "string",
  "escalationReason": "string",
  "confidence": number
}`;
  }

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

  // Channel specific formatting
  if (channel !== 'email') {
    toneInstructions.push(
      '- Live Chat/Widget: Keep messages short and split into multiple lines if needed.',
    );
    toneInstructions.push(
      '- Do NOT use complex markdown headers or bullets unless necessary.',
    );
    toneInstructions.push('- Be conversational and quick.');
  }

  // Greetings - ONLY APPLY if replying
  if (org.aiIncludeGreetings === false && channel !== 'email') {
    toneInstructions.push(
      '- Skip greetings, get straight to addressing the issue',
    );
  } else {
    if (channel === 'email' && customerName) {
      toneInstructions.push(`- Start the email with "Dear ${customerName},"`);
    } else {
      toneInstructions.push('- Start with friendly greetings (if replying)');
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
    // Explicitly forbid markdown for email clients
    toneInstructions.push(
      '- CRITICAL: Do NOT use any markdown formatting in the content field. Email clients do not render it.',
    );
    toneInstructions.push(
      '- Do NOT use **bold**, *italics*, `code`, or [links](url).',
    );
    toneInstructions.push('- Use plain text only. Use "1." or "-" for lists.');
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
    return `${basePrompt}\n\n# TONE GUIDELINES\n${toneInstructions.join('\n')}`;
  }

  return basePrompt;
}

export type AgentResponse = {
  content?: string;
  action: 'REPLY' | 'ESCALATE';
  escalationReason?: string;
  confidence: number;
  metadata: {
    tokenUsage: any;
    knowledgeBaseUsed: boolean;
    performanceMs: number;
  };
};

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
  channel?: string,
  isWaitingForNewTopicCheck = false,
): Promise<AgentResponse> => {
  const totalStart = Date.now();
  console.log(`[PERF] draftResponse started for ticket ${ticket_id}`);

  // ========== PARALLELIZED DATA FETCHING ==========
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

  const systemPrompt = buildSystemPrompt(org, channel, customerName);

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService);
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // ========== TOOL DEFINITION ==========
  const tools = [
    {
      name: 'create_new_ticket',
      description:
        'Create a NEW ticket for a NEW issue that is different from the current one.',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'A concise subject for the new ticket',
          },
          description: {
            type: 'string',
            description: 'Detailed description of the new issue',
          },
        },
        required: ['subject', 'description'],
      },
    },
  ];

  let modelWithTools = model;
  if (isWaitingForNewTopicCheck && (model as any).bindTools) {
    try {
      modelWithTools = (model as any).bindTools(tools);
    } catch (e) {
      console.warn('Tool binding failed, falling back to standard model', e);
    }
  }

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

${
  additionalContext
    ? `Analyze this ticket and decide whether to reply or escalate. Additional context: ${additionalContext}`
    : `Analyze this ticket and decide whether to reply or escalate. Consider all threads, messages, ticket details, conversation history, and customer sentiment.`
}

${
  isWaitingForNewTopicCheck
    ? `
# SECONDARY SUPPORT BUFFER (ACTIVE)
The user is currently waiting on an escalated issue. 
Your task is to determine if their latest message refers to a NEW, DIFFERENT problem.
- If they want to discuss a NEW topic or asked for help with something else: Use the 'create_new_ticket' tool.
- If they are still talking about the SAME escalated issue: Just reply normally (usually with empathy/patience).
- If they answer "yes" to "is there anything else I can help with": Use the tool to start a new ticket for them.
`
    : ''
}
`;

  // Add knowledge base context if available
  if (knowledgeContext) {
    contextPrompt += `\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information from our knowledge base to inform your response:\n\n${knowledgeContext}`;
  }

  // ========== PREPARE IMAGES FOR AI CONTEXT ==========
  // Extract images from recent messages to provide visual context
  const images: any[] = [];
  try {
    const base64Regex = /data:image\/([a-zA-Z+]*);base64,([^"'\s>]+)/g;
    const urlRegex =
      /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s]*)?)/gi;

    // Scan ticket description and raw body for images
    const ticketSearchContent =
      (ticketData.ticket.description || '') + (ticketData.ticket.rawBody || '');

    console.log(
      `[AI Agent] Scanning ${threadsWithMessages.length} threads + ticket for images...`,
    );

    let tMatch;
    while ((tMatch = base64Regex.exec(ticketSearchContent)) !== null) {
      console.log(`[AI Agent] Found base64 image in ticket description`);
      images.push({
        mimeType: `image/${tMatch[1] === 'jpeg' ? 'jpeg' : tMatch[1] || 'png'}`,
        base64Data: tMatch[2],
        isBase64: true,
        filename: 'ticket_embedded_image',
      });
    }

    const tUrls = ticketSearchContent.match(urlRegex);
    if (tUrls) {
      console.log(
        `[AI Agent] Found ${tUrls.length} image URLs in ticket description`,
      );
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

    threadsWithMessages.forEach((thread: any, tIdx: number) => {
      if (thread.messages && Array.isArray(thread.messages)) {
        thread.messages.forEach((msg: any, mIdx: number) => {
          if (msg.attachments && Array.isArray(msg.attachments)) {
            msg.attachments.forEach((att: any) => {
              const mime = att.mimeType || att.mime_type || att.mimetype;
              if (mime && mime.startsWith('image/')) {
                console.log(
                  `[AI Agent] Found image attachment in Thread ${tIdx} Msg ${mIdx}: ${att.path || 'base64'}`,
                );
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
            console.log(
              `[AI Agent] Found embedded base64 image in Thread ${tIdx} Msg ${mIdx}`,
            );
            images.push({
              mimeType: `image/${bMatch[1] === 'jpeg' ? 'jpeg' : bMatch[1] || 'png'}`,
              base64Data: bMatch[2],
              isBase64: true,
              filename: 'embedded_image',
            });
          }

          // Check for URLs in message content
          const foundUrls = msgSearchContent.match(urlRegex);
          if (foundUrls) {
            console.log(
              `[AI Agent] Found ${foundUrls.length} image URLs in Thread ${tIdx} Msg ${mIdx}`,
            );
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

    console.log(`[AI Agent] Total images found: ${images.length}`);
  } catch (e) {
    console.warn('Error extracting images for AI context:', e);
  }

  // Take most recent 3 images
  const recentImages = images.slice(-3);
  const imageContents: any[] = [];

  if (recentImages.length > 0) {
    console.log(
      `[AI Agent] Fetching ${recentImages.length} images for context...`,
    );
    await Promise.all(
      recentImages.map(async (img) => {
        try {
          let base64Data = '';
          if (img.isBase64) {
            console.log(`[AI Agent] Using pre-encoded base64 data for image`);
            base64Data = img.base64Data;
          } else if (
            typeof img.path === 'string' &&
            img.path.startsWith('http')
          ) {
            console.log(`[AI Agent] Fetching image from URL: ${img.path}`);
            // Add a 10s timeout to image fetching
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(img.path, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              base64Data = Buffer.from(arrayBuffer).toString('base64');
              console.log(
                `[AI Agent] Successfully fetched and encoded image (${base64Data.length} chars)`,
              );
            } else {
              console.error(
                `[AI Agent] Failed to fetch image: ${res.status} ${res.statusText}`,
              );
            }
          } else {
            console.error(
              `[AI Agent] Image path does not start with http: ${img.path}`,
            );
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
          console.error(`Failed to fetch image for AI context: ${img.path}`, e);
        }
      }),
    );
  }

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();
  let response;

  try {
    let userContent: any = contextPrompt;

    // Inject images if available
    if (imageContents.length > 0) {
      console.log(
        `[AI Agent] Injecting ${imageContents.length} images into prompt for LLM`,
      );
      userContent = [{ type: 'text', text: contextPrompt }, ...imageContents];
    }

    // Add 30s timeout to LLM invocation
    response = await Promise.race([
      modelWithTools.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ]),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('AI response timed out')), 30000),
      ),
    ]);

    // ========== HANDLE TOOL CALLS ==========
    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log(
        `[AI Agent] Tool call detected: ${response.tool_calls[0].name}`,
      );
      const toolCall = response.tool_calls[0];

      if (toolCall.name === 'create_new_ticket') {
        const { subject, description } = toolCall.args;
        console.log(`[AI Agent] Creating new ticket: ${subject}`);

        // Execute ticket creation
        const newTicket = await ticketsService.create(
          {
            subject,
            description,
            status: 'open' as any,
            customerId:
              (ticket.customerId as any)._id?.toString() ||
              ticket.customerId.toString(),
            priority: 'medium' as any,
          },
          organizationId,
          channel,
        );

        // Return a special response indicating tool execution
        return {
          action: 'REPLY',
          content: `I've created a new ticket (#${(newTicket as any).displayId || (newTicket as any)._id}) for your inquiry about "${subject}". I'll help you with that there, while our team continues to work on your other escalated request.`,
          confidence: 100,
          metadata: {
            tokenUsage: (response as any)?.usage_metadata,
            knowledgeBaseUsed: false,
            performanceMs: Date.now() - totalStart,
          },
        };
      }
    }
  } catch (error) {
    console.error('[AI Agent] LLM Invocation Failed:', error);

    // Return escalation on error
    return {
      action: 'ESCALATE',
      escalationReason: 'AI Service Unavailable or Error',
      confidence: 0,
      metadata: {
        tokenUsage: {},
        knowledgeBaseUsed: !!knowledgeContext,
        performanceMs: Date.now() - totalStart,
      },
    };
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract content and parse JSON
  let result: any = { action: 'ESCALATE', confidence: 0 };
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

    // Clean markdown code blocks if present
    const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();

    result = JSON.parse(cleanJson);

    // Validate action
    if (!['REPLY', 'ESCALATE'].includes(result.action)) {
      throw new Error('Invalid action returned by AI');
    }
  } catch (e) {
    console.error('Failed to parse AI response as JSON:', e);
    console.log('Raw response:', responseText);

    // Fallback: If we can't parse JSON, treat it as a REPLY if it looks like text, or ESCALATE if it fails
    // But since we asked for JSON, a failure usually means we should escalate
    return {
      action: 'ESCALATE',
      escalationReason: 'AI response malformed',
      confidence: 0,
      metadata: {
        tokenUsage: (response as any)?.response_metadata?.tokenUsage,
        knowledgeBaseUsed: !!knowledgeContext,
        performanceMs: Date.now() - totalStart,
      },
    };
  }

  console.log(`[PERF] TOTAL draftResponse: ${Date.now() - totalStart}ms`);

  return {
    content: result.content,
    action: result.action,
    escalationReason: result.escalationReason,
    confidence: result.confidence || 0,
    metadata: {
      tokenUsage:
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      knowledgeBaseUsed: !!knowledgeContext,
      performanceMs: Date.now() - totalStart,
    },
  };
};
