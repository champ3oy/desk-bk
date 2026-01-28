import { Injectable, Logger } from '@nestjs/common';
import { TrainingService } from '../training/training.service';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

  constructor(
    private readonly trainingService: TrainingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get or create a singleton embeddings instance
   */
  private getEmbeddingsInstance(): GoogleGenerativeAIEmbeddings | null {
    if (this.embeddingsInstance) {
      return this.embeddingsInstance;
    }

    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    if (!apiKey) {
      this.logger.warn('Gemini API key not configured');
      return null;
    }

    this.embeddingsInstance = new GoogleGenerativeAIEmbeddings({
      modelName: 'gemini-embedding-001',
      apiKey,
    });

    this.logger.log('Created singleton embeddings instance');
    return this.embeddingsInstance;
  }

  /**
   * Retrieve relevant knowledge base content for a given query
   * Uses vector embeddings for semantic search.
   */
  async retrieveRelevantContent(
    query: string,
    organizationId: string,
    maxResults: number = 3,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const embeddings = this.getEmbeddingsInstance();
      if (!embeddings) {
        return '';
      }

      // Generate embedding for the query with a strict timeout
      // If embedding takes too long (e.g. strict rate limit waits), skip KB
      const embeddingStart = Date.now();

      // Wrap in semaphore to prevent concurrency issues
      const { geminiSemaphore } = require('./concurrency-semaphore');

      const queryEmbedding = await geminiSemaphore.run(() =>
        Promise.race([
          embeddings.embedQuery(query),
          new Promise<number[]>((_, reject) =>
            setTimeout(() => reject(new Error('Embedding timeout')), 3000),
          ),
        ]),
      );

      this.logger.debug(
        `[PERF] Embedding generation: ${Date.now() - embeddingStart}ms`,
      );

      // Perform vector search
      const vectorSearchStart = Date.now();
      const results = await this.trainingService.findSimilar(
        queryEmbedding,
        organizationId,
        maxResults,
      );
      this.logger.debug(
        `[PERF] Vector search: ${Date.now() - vectorSearchStart}ms`,
      );

      if (results.length === 0) {
        this.logger.debug(
          `[PERF] Total retrieveRelevantContent: ${Date.now() - startTime}ms (no results)`,
        );
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

      this.logger.debug(
        `[PERF] Total retrieveRelevantContent: ${Date.now() - startTime}ms (${results.length} results)`,
      );
      return contextParts.join('\n\n');
    } catch (error) {
      if (error.message === 'Embedding timeout') {
        this.logger.warn(
          `Knowledge base retrieval timed out. Skipping KB context.`,
        );
      } else {
        this.logger.error(
          `Failed to retrieve knowledge base content: ${error.message}`,
        );
      }
      return ''; // Absolutely fail open (ignore error and continue without KB)
    }
  }
}
