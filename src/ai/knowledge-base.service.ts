import { Injectable } from '@nestjs/common';
import { TrainingService } from '../training/training.service';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly trainingService: TrainingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Retrieve relevant knowledge base content for a given query
   * This is a simple keyword-based retrieval. For production, use vector embeddings.
   */
  async retrieveRelevantContent(
    query: string,
    organizationId: string,
    maxResults: number = 3,
  ): Promise<string> {
    try {
      const apiKey = this.configService.get<string>('ai.geminiApiKey');
      if (!apiKey) {
        console.warn('Gemini API key not configured');
        return '';
      }

      // Generate embedding for the query
      const embeddings = new GoogleGenerativeAIEmbeddings({
        modelName: 'embedding-001',
        apiKey,
      });
      const queryEmbedding = await embeddings.embedQuery(query);

      // Perform vector search
      const results = await this.trainingService.findSimilar(
        queryEmbedding,
        organizationId,
        maxResults,
      );

      if (results.length === 0) {
        return '';
      }

      // Format the relevant content
      const contextParts = results.map((source) => {
        const content = source.content || '';
        // Truncate long content to avoid token limits
        const truncated =
          content.length > 2000 ? content.substring(0, 2000) + '...' : content;

        return `## ${source.name}\n${truncated}`;
      });

      return contextParts.join('\n\n');
    } catch (error) {
      console.error('Failed to retrieve knowledge base content:', error);
      return '';
    }
  }
}
