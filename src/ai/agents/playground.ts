import { AIModelFactory } from '../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../../organizations/organizations.service';
import { buildSystemPrompt } from './response';
import { KnowledgeBaseService } from '../knowledge-base.service';
import { CustomersService } from '../../customers/customers.service';

export const playgroundChat = async (
  message: string,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: KnowledgeBaseService,
  customersService: CustomersService,
  organizationId: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  provider?: string,
  modelName?: string,
  customerEmail?: string,
) => {
  const totalStart = Date.now();
  console.log(`[PERF] playgroundChat started`);

  // ========== PARALLELIZED DATA FETCHING ==========
  // Fetch organization, customer (if email provided), and knowledge base in parallel
  const parallelStart = Date.now();

  const [org, customer, knowledgeContext] = await Promise.all([
    organizationsService.findOne(organizationId),
    customerEmail
      ? customersService.findByEmail(customerEmail, organizationId)
      : Promise.resolve(null),
    knowledgeBaseService
      ? knowledgeBaseService
          .retrieveRelevantContent(message, organizationId, 3)
          .catch((error: Error) => {
            console.error('Failed to retrieve knowledge base content:', error);
            return '';
          })
      : Promise.resolve(''),
  ]);

  console.log(
    `[PERF] Parallel fetch (org + customer + KB): ${Date.now() - parallelStart}ms`,
  );

  // ========== BUILD SYSTEM PROMPT ==========
  let systemPrompt = buildSystemPrompt(org);

  // --- Customer Context & Mini Agent Logic ---
  let customerValues: any = null;

  // 1. If we have a customer from lookup
  if (customer) {
    customerValues = customer;
    systemPrompt += `\n\nCONTEXT: You are speaking with a known customer named ${customer.firstName} ${customer.lastName} (Email: ${customer.email}). You MUST address them by name in your greeting and personalize the conversation.`;
  }

  // 2. If no customer identified yet, instruct AI to extract info
  if (!customerValues) {
    systemPrompt += `\n\nOBJECTIVE: The user is currently unidentified (anonymous). Your goal is to help them but also to populate our CRM.
    
    INSTRUCTIONS:
    1. If you do not know the user's name or email, politely ask for it naturally during the conversation (e.g., "To better assist you, could I get your name and email?").
    2. If the user provides their Name and/or Email, you MUST extract it into a special JSON block at the VERY START of your response.
    3. The JSON block must look exactly like this: [[CUSTOMER_INFO: {"firstName": "John", "lastName": "Doe", "email": "john@example.com"}]]
    4. IMMIDIATELY AFTER the [[CUSTOMER_INFO]] block (or if no info was provided), you MUST output the structured JSON response as required by the system instructions.
    5. The final output should look like: [[CUSTOMER_INFO: {...}]] {"action": "REPLY", "content": "...", "confidence": 100}
    6. If no customer info is being extracted, just output the JSON object alone.
    7. Do not invent names. Only use what the user provides.`;
  }
  // -------------------------------------------

  // Build full prompt with knowledge context
  let fullPrompt = message;
  if (knowledgeContext) {
    fullPrompt = `User Query: ${message}\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information to help answer the user's query if relevant:\n${knowledgeContext}`;
  }

  // ========== MODEL INITIALIZATION ==========
  const modelStart = Date.now();
  const model = AIModelFactory.create(configService, {
    provider,
    model: modelName,
  });
  console.log(`[PERF] Model initialization: ${Date.now() - modelStart}ms`);

  // Build messages array with history
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history if provided
  if (history && history.length > 0) {
    // Filter out messages with empty content to satisfy Gemini requirements
    const validHistory = history.filter(
      (msg) => msg.content && msg.content.trim() !== '',
    );
    messages.push(...validHistory);
  }

  // Add current user message
  messages.push({ role: 'user', content: fullPrompt });

  // ========== LLM INVOCATION ==========
  const llmStart = Date.now();
  let response;

  try {
    response = await model.invoke(messages);
  } catch (error) {
    console.error('[AI Agent] LLM Invocation Failed:', error);

    // Check for rate limit error
    if (error.status === 429 || error.message?.includes('429')) {
      const isDailyLimit =
        JSON.stringify(error).includes('PerDay') ||
        error.message?.includes('PerDay');

      const message = isDailyLimit
        ? `You have exhausted your DAILY quota for this model (${modelName}). Please switch to a different model (like Gemini 1.5 Flash) or wait until tomorrow.`
        : "I'm currently receiving too many requests. Please wait about a minute and try again. (Google Gemini Free Tier Minute Limit Hit)";

      return {
        content: message,
        customer: null,
        performanceMs: Date.now() - totalStart,
      };
    }

    // Check for Langchain/Gemini parsing error (empty candidates)
    if (
      error.name === 'TypeError' &&
      error.message?.includes("reading 'reduce'")
    ) {
      console.warn(
        '[AI Agent] Empty response from Gemini (Safety Filter or Network)',
      );
      return {
        content:
          "I'm sorry, I couldn't generate a response. This might be due to safety filters on the AI model or a temporary connection issue. Please try rephrasing your request.",
        customer: null,
        performanceMs: Date.now() - totalStart,
      };
    }

    // Fallback for other errors
    return {
      content:
        'I encountered an error generating a response. Please check the server logs.',
      customer: null,
      performanceMs: Date.now() - totalStart,
    };
  }

  console.log(`[PERF] LLM invocation: ${Date.now() - llmStart}ms`);

  const content = response.content;
  let detectedCustomer: any = null;

  // Handle potential complex content types (array of text/image)
  // Handle potential complex content types (array of text/image)
  let responseText =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  // Parse structured JSON response (Reply vs Escalate) logic
  // Since we share the system prompt with draftResponse, the model will output JSON.
  try {
    // More robust JSON extraction
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.action === 'ESCALATE') {
        // Use a simple template instead of making a second LLM call
        // This saves 2-5 seconds per escalation
        responseText =
          "I'll connect you with a human agent who can better assist you with this request. They'll be with you shortly.";
      } else if (parsed.action === 'REPLY' && parsed.content) {
        responseText = parsed.content;
      }
    }
  } catch (e) {
    // If parsing fails, just use the raw text (fallback)
    console.warn('[Playground] Failed to parse JSON response, using raw text');
  }

  const responseContent = responseText;

  // --- Post-Processing: Check for Customer Extraction ---
  const extractionRegex = /\[\[CUSTOMER_INFO: ({.*?})\]\]/s;
  const match = responseContent.match(extractionRegex);

  let finalContent = responseContent;

  if (match && match[1]) {
    try {
      const extractedData = JSON.parse(match[1]);

      // Clean the response
      finalContent = responseContent.replace(match[0], '').trim();

      // Create/Update Customer
      if (extractedData.email) {
        console.log('[AI Agent] Extracted Customer Info:', extractedData);
        detectedCustomer = await customersService.findOrCreate(
          extractedData,
          organizationId,
        );
      }
    } catch (e) {
      console.error('[AI Agent] Failed to parse extracted customer info', e);
    }
  }
  // --------------------------------------------------

  console.log(`[PERF] TOTAL playgroundChat: ${Date.now() - totalStart}ms`);

  return {
    content: finalContent,
    customer: detectedCustomer, // Optional: return this to frontend if needed
    performanceMs: Date.now() - totalStart,
  };
};
