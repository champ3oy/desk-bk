import { AIModelFactory } from '../../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { TicketsService } from '../../../tickets/tickets.service';
import { ThreadsService } from '../../../threads/threads.service';
import { CommentsService } from '../../../comments/comments.service';
import { UserRole } from '../../../users/entities/user.entity';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

const systemPrompt = `You are an expert ticket summarizer and analyst. You must analyze the provided ticket data and return a JSON object containing a comprehensive summary, sentiment analysis, urgency level, main topic, and recommended actions.

Do not mention ticket ID
CRITICAL: If there are images (screenshots), you MUST READ ALL TEXT from them and include the exact error messages or details in the summary.
keep details brief and concise

JSON Structure:
{
  "summary": "the summary should be properly formatted markdown and put it in this sections:
1. A brief overview of the issue
2. Key points from the conversation (Include exact text read from any screenshots)
3. Current status and any pending actions
4. Customer's main concerns.",
  "sentiment": "One of: Frustrated, Neutral, Happy, Angry, Concerned",
  "urgency": "One of: Low, Medium, High, Urgent",
  "topic": "Brief topic label (e.g., Billing, Bug, Feature Request, Question)"
}`;

export const summarizeTicket = async (
  ticket_id: string,
  ticketsService: TicketsService,
  threadsService: ThreadsService,
  commentsService: CommentsService,
  configService: ConfigService,
  userId: string,
  userRole: UserRole,
  organizationId: string,
) => {
  const totalStart = Date.now();
  console.log(`[PERF] summarizeTicket started for ticket ${ticket_id}`);

  // ========== PARALLELIZED DATA FETCHING ==========
  const parallelStart = Date.now();

  const [ticket, threads, comments] = await Promise.all([
    ticketsService.findOne(ticket_id, userId, userRole, organizationId),
    threadsService.findAll(ticket_id, organizationId, userId, userRole),
    commentsService.findAll(ticket_id, userId, userRole),
  ]);

  console.log(
    `[PERF] Parallel fetch (ticket + threads + comments): ${Date.now() - parallelStart}ms`,
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

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService);
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // ========== BUILD CONTEXT WITH PRE-FETCHED DATA ==========
  const ticketData = {
    ticket: ticket.toObject(),
    threads: threadsWithMessages,
    comments: JSON.parse(JSON.stringify(comments)),
  };

  const contextPrompt = `# TICKET DATA FOR ANALYZATION
  
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
  ticketData.comments.length > 0
    ? ticketData.comments
        .map(
          (comment: any) =>
            `[${comment.isInternal ? 'Internal' : 'Public'}] ${comment.content}`,
        )
        .join('\n')
    : 'No comments'
}

# TASK
Respond ONLY with a JSON object. Analyze the ticket and provide:
1. summary: A rich markdown summary of the issue and conversation.
2. sentiment: The primary emotional tone of the customer.
3. urgency: The priority from a customer satisfaction and business impact perspective.
4. topic: A short, representative tag for the issue.`;

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
      `[AI Summary] Scanning ${threadsWithMessages.length} threads for images...`,
    );
    threadsWithMessages.forEach((thread: any, tIdx: number) => {
      console.error(
        `[AI Summary] Thread ${tIdx}: ${thread.messages?.length || 0} messages`,
      );
      if (thread.messages && Array.isArray(thread.messages)) {
        thread.messages.forEach((msg: any, mIdx: number) => {
          console.error(
            `[AI Summary] Msg ${mIdx} content: "${msg.content?.substring(0, 50)}..."`,
          );
          console.error(
            `[AI Summary] Msg ${mIdx} keys: ${Object.keys(msg).join(', ')}`,
          );

          if (msg.attachments && msg.attachments.length > 0) {
            console.error(
              `[AI Summary] Msg ${mIdx} has ${msg.attachments.length} attachments`,
            );
            msg.attachments.forEach((att: any) => {
              // Log attachment structure to debug property names
              console.error('Found attachment:', JSON.stringify(att));

              const mime = att.mimeType || att.mime_type || att.mimetype;
              if (mime && mime.startsWith('image/')) {
                if (att.path) {
                  // normalize property for downstream processing
                  images.push({ ...att, mimeType: mime });
                } else if (att.base64 || att.data) {
                  // handle base64 attachments if they exist
                  images.push({
                    mimeType: mime,
                    base64Data: att.base64 || att.data,
                    isBase64: true,
                    filename: att.filename || 'attachment_image',
                  });
                }
              } else {
                console.error(
                  '[AI Summary] Skipping attachment: Missing mime or path, or not an image.',
                  { mime, path: att.path },
                );
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

          // Fallback: Check if content looks like a URL starting with http and ending in image extension
          const foundUrls = msgSearchContent.match(urlRegex);
          if (foundUrls) {
            console.error(
              `[AI Summary] Found ${foundUrls.length} image URLs in message content fallback`,
            );
            foundUrls.forEach((url: string) => {
              // Only add if not already present via attachments
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
    console.warn('Error extracting images for AI summary:', e);
  }

  // Take most recent 3 images
  const recentImages = images.slice(-3);
  const imageContents: any[] = [];

  if (recentImages.length > 0) {
    console.error(
      `[AI Summary] Fetching ${recentImages.length} images for context...`,
    );
    await Promise.all(
      recentImages.map(async (img) => {
        try {
          console.error(
            `[AI Summary] Processing image: ${img.path} (${img.mimeType})`,
          );

          let base64Data = '';
          if (img.isBase64) {
            base64Data = img.base64Data;
          } else if (
            typeof img.path === 'string' &&
            img.path.startsWith('http')
          ) {
            const res = await fetch(img.path);
            console.error(
              `[AI Summary] Fetch status for ${img.path}: ${res.status} ${res.statusText}`,
            );

            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              base64Data = Buffer.from(arrayBuffer).toString('base64');
              console.error(
                `[AI Summary] Successfully encoded image, length: ${base64Data.length}`,
              );
            } else {
              console.error(
                `[AI Summary] Failed to fetch image: ${res.status}`,
              );
            }
          } else {
            console.error(
              `[AI Summary] Image path does not start with http: ${img.path}`,
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
          console.error(`Failed to fetch image for AI summary: ${img.path}`, e);
        }
      }),
    );
  } else {
    console.error('[AI Summary] No images found in conversation.');
  }

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();

  let response;
  try {
    const userMessageContent: any[] = [{ type: 'text', text: contextPrompt }];

    // Inject images if available
    if (imageContents.length > 0) {
      console.log(
        `[AI Summary] Injecting ${imageContents.length} images into prompt`,
      );
      imageContents.forEach((img) => {
        // Ensure strictly following the requested structure
        console.log(
          `[AI Summary] Adding image ${img.mime_type}, size: ${img.data.length} chars`,
        );
        userMessageContent.push({
          type: 'image',
          source_type: 'base64',
          mime_type: img.mime_type,
          data: img.data,
        });
      });
    }

    response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: userMessageContent,
      }),
    ]);
  } catch (error: any) {
    console.error(`[ERROR] summarizeTicket LLM invocation failed:`, error);
    // ... rest of error handling same ...
    const errorMessage = error?.message || String(error);
    if (
      errorMessage.includes('429') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('RESOURCE_EXHAUSTED')
    ) {
      return {
        summary: null,
        content: null,
        error:
          'AI service is currently rate limited. Please try again in a few moments.',
        metadata: {
          performanceMs: Date.now() - totalStart,
          errorType: 'rate_limit',
        },
      };
    }

    return {
      summary: null,
      content: null,
      error:
        'Failed to generate summary. The AI service may be temporarily unavailable.',
      metadata: {
        performanceMs: Date.now() - totalStart,
        errorType: 'ai_error',
      },
    };
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  // Extract and Parse JSON
  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  let parsedData: any = {};
  try {
    // Attempt to extract JSON if LLM returned markdown blocks
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : rawContent;
    parsedData = JSON.parse(jsonString);
  } catch (e) {
    console.warn(
      '[WARN] Failed to parse JSON from AI response, falling back',
      e,
    );
    parsedData = {
      summary: rawContent,
      sentiment: 'Neutral',
      urgency: 'Medium',
      topic: 'General',
    };
  }

  console.log(`[PERF] TOTAL summarizeTicket: ${Date.now() - totalStart}ms`);

  return {
    summary: parsedData.summary || rawContent,
    content: rawContent,
    sentiment: parsedData.sentiment || 'Neutral',
    urgency: parsedData.urgency || 'Medium',
    topic: parsedData.topic || 'General',
    error: null,
    metadata: {
      tokenUsage:
        (response as any)?.usage_metadata ||
        (response as any)?.response_metadata?.tokenUsage,
      performanceMs: Date.now() - totalStart,
    },
  };
};
