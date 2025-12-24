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
  // Fetch organization settings
  const org = await organizationsService.findOne(organizationId);
  let systemPrompt = buildSystemPrompt(org);

  // --- Customer Context & Mini Agent Logic ---
  let customerValues: any = null;

  // 1. If we have a customerEmail, lookup the customer
  if (customerEmail) {
    const customer = await customersService.findByEmail(
      customerEmail,
      organizationId,
    );
    if (customer) {
      customerValues = customer;
      systemPrompt += `\n\nCONTEXT: You are speaking with a known customer named ${customer.firstName} ${customer.lastName} (Email: ${customer.email}). You MUST address them by name in your greeting and personalize the conversation.`;
    }
  }

  // 2. If no customer identified yet, instruct AI to extract info
  if (!customerValues) {
    systemPrompt += `\n\nOBJECTIVE: The user is currently unidentified (anonymous). Your goal is to help them but also to populate our CRM.
    
    INSTRUCTIONS:
    1. If you do not know the user's name or email, politely ask for it naturally during the conversation (e.g., "To better assist you, could I get your name and email?").
    2. If the user provides their Name and/or Email, you MUST extract it into a special JSON block at the VERY START of your response.
    3. The JSON block must look exactly like this: [[CUSTOMER_INFO: {"firstName": "John", "lastName": "Doe", "email": "john@example.com"}]]
    4. Provide the answer to their request AFTER this block.
    5. Do not invent names. Only use what the user provides.`;
  }
  // -------------------------------------------

  // Retrieve relevant knowledge base content
  let knowledgeContext = '';
  if (knowledgeBaseService) {
    try {
      knowledgeContext = await knowledgeBaseService.retrieveRelevantContent(
        message,
        organizationId,
        3, // Max 3 relevant documents
      );
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
    }
  }

  // Build full prompt
  let fullPrompt = message;
  if (knowledgeContext) {
    fullPrompt = `User Query: ${message}\n\n# KNOWLEDGE BASE CONTEXT\nUse the following information to help answer the user's query if relevant:\n${knowledgeContext}`;
  }

  const model = AIModelFactory.create(configService, {
    provider,
    model: modelName,
  });

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

  // Generate response
  const response = await model.invoke(messages);

  let content = response.content;
  let detectedCustomer: any = null;

  // Handle potential complex content types (array of text/image)
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

  return {
    content: finalContent,
    customer: detectedCustomer, // Optional: return this to frontend if needed
  };
};
