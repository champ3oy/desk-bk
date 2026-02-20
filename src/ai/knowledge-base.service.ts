import { Injectable, Logger } from '@nestjs/common';
import { TrainingService } from '../training/training.service';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { AiUsageService } from './telemetry/ai-usage.service';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);
  private embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

  // In-memory KB result cache: key -> { result, expiresAt }
  // 5 minute TTL — cheap to hold, avoids re-embedding the same query repeatedly
  private readonly kbCache = new Map<
    string,
    { result: string; expiresAt: number }
  >();
  private readonly KB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

    const allKeys = (
      this.configService.get<string>('ai.geminiApiKey') || ''
    ).split(',');

    // Pick a key (if multiple, pick first for now for the singleton, or support rotation)
    // Actually, embeddingsInstance is a singleton, so we pick one and stick with it
    // or we could recreate it on failure, but for now let's just pick one.
    const apiKey = allKeys[0]?.trim();

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

    // Check cache first
    const cacheKey = `${organizationId}:${query.trim().toLowerCase()}`;
    const cached = this.kbCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`[KB Cache] HIT for query: "${query}"`);
      return cached.result;
    }

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

      // Log usage for embedding
      AiUsageService.logUsageAndDeduct({
        provider: 'google',
        modelName: 'gemini-embedding-001',
        inputTokens: AiUsageService.estimateTokens(query),
        outputTokens: 0,
        performanceMs: Date.now() - embeddingStart,
        metadata: { type: 'query-embedding' },
      });

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
        // Cache empty results too (1 min TTL) to prevent hammering for unindexed queries
        this.kbCache.set(cacheKey, {
          result: '',
          expiresAt: Date.now() + 60_000,
        });
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
      const finalResult = contextParts.join('\n\n');

      // Cache the result for 5 minutes
      this.kbCache.set(cacheKey, {
        result: finalResult,
        expiresAt: Date.now() + this.KB_CACHE_TTL_MS,
      });
      this.logger.debug(`[KB Cache] STORED result for query: "${query}"`);

      return finalResult;
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
