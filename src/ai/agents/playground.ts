import { AIModelFactory } from '../ai-model.factory';
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
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  provider?: string,
  modelName?: string,
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
