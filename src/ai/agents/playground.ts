import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from '../../organizations/organizations.service';
import { buildSystemPrompt } from './response';
import { KnowledgeBaseService } from '../knowledge-base.service';

export const playgroundChat = async (
  message: string,
  configService: ConfigService,
  organizationsService: OrganizationsService,
  knowledgeBaseService: KnowledgeBaseService,
  organizationId: string,
) => {
  // Fetch organization settings
  const org = await organizationsService.findOne(organizationId);
  const systemPrompt = buildSystemPrompt(org);

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

  // Initialize model
  const apiKey = configService.get<string>('ai.geminiApiKey');
  const modelName =
    configService.get<string>('ai.model') || 'gemini-2.0-flash-exp';

  if (!apiKey) {
    throw new Error('Gemini API key is not configured.');
  }

  const model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
  });

  // Generate response
  const response = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: fullPrompt },
  ]);

  const content = response.content;

  // Handle potential complex content types (array of text/image) - simplifying for text-only playground
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

  return {
    content: responseContent,
  };
};
