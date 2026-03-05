import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { SmartCache, SmartCacheDocument } from './entities/smart-cache.entity';
import { AIModelFactory } from './ai-model.factory';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { AiUsageService } from './telemetry/ai-usage.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { Inject, forwardRef } from '@nestjs/common';

@Injectable()
export class SmartCacheService {
  private readonly logger = new Logger(SmartCacheService.name);
  private embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

  // In-memory cache for literal matches (hot routes)
  // Key: organizationId:kbVersion:rawQuery -> cachedResponse
  private readonly literalCache = new Map<string, string>();

  private isSimpleGreeting(query: string): boolean {
    const q = query
      .trim()
      .toLowerCase()
      .replace(/[!?.,]$/, '');
    const greetings = [
      'hi',
      'hello',
      'hey',
      'yo',
      'good morning',
      'good afternoon',
      'good evening',
      'hola',
      'hi there',
      'hello there',
    ];
    return greetings.includes(q);
  }

  constructor(
    @InjectModel(SmartCache.name)
    private smartCacheModel: Model<SmartCacheDocument>,
    private configService: ConfigService,
    @Inject(forwardRef(() => OrganizationsService))
    private organizationsService: OrganizationsService,
  ) {}

  private getEmbeddingsInstance(): GoogleGenerativeAIEmbeddings | null {
    if (this.embeddingsInstance) return this.embeddingsInstance;
    const apiKey = this.configService
      .get<string>('ai.geminiApiKey')
      ?.split(',')[0]
      .trim();
    if (!apiKey) return null;
    this.embeddingsInstance = new GoogleGenerativeAIEmbeddings({
      modelName: 'gemini-embedding-001',
      apiKey,
    });
    return this.embeddingsInstance;
  }

  async findMatch(
    query: string,
    organizationId: string,
  ): Promise<{
    response: string | null;
    type: 'LITERAL' | 'SEMANTIC' | 'NONE';
    score?: number;
  }> {
    const rawQuery = query.trim().toLowerCase();

    // 0. Super Fast Path: Simple Greetings
    if (this.isSimpleGreeting(rawQuery)) {
      this.logger.debug(
        `[SmartCache] SUPER FAST hit for greeting: "${rawQuery}"`,
      );
      return { response: 'TEMPLATE:GREETING', type: 'LITERAL' };
    }

    const org = await this.organizationsService.findOne(organizationId);
    const currentKbVersion = org?.aiKbVersion || 'v1';
    const literalKey = `${organizationId}:${currentKbVersion}:${rawQuery}`;

    // 1. Check In-Memory Literal Cache
    if (this.literalCache.has(literalKey)) {
      this.logger.debug(
        `[SmartCache] LITERAL hit for: "${query.substring(0, 30)}..."`,
      );
      return { response: this.literalCache.get(literalKey)!, type: 'LITERAL' };
    }

    // 2. Check Semantic Cache (MongoDB Vector Search)
    const embeddings = this.getEmbeddingsInstance();
    if (!embeddings) return { response: null, type: 'NONE' };

    const startTime = Date.now();
    try {
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
        `[SmartCache] Embedding generated in ${Date.now() - startTime}ms`,
      );

      const results = await this.smartCacheModel
        .aggregate([
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'queryEmbedding',
              queryVector: queryEmbedding,
              numCandidates: 20,
              limit: 1,
              filter: {
                organizationId: new Types.ObjectId(organizationId),
                kbVersion: currentKbVersion,
              },
            },
          },
          {
            $project: {
              cachedResponse: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .exec();

      if (results.length > 0) {
        // Log usage for embedding
        AiUsageService.logUsageAndDeduct({
          provider: 'google',
          modelName: 'gemini-embedding-001',
          inputTokens: AiUsageService.estimateTokens(query),
          outputTokens: 0,
          performanceMs: Date.now() - startTime,
          metadata: { type: 'cache-search-embedding' },
        });

        const bestMatch = results[0];
        const score = bestMatch.score;

        if (score >= 0.94) {
          this.logger.debug(
            `[SmartCache] SEMANTIC hit (score: ${score.toFixed(4)}) in ${Date.now() - startTime}ms`,
          );
          // Populate literal cache for next time
          this.literalCache.set(literalKey, bestMatch.cachedResponse);
          return {
            response: bestMatch.cachedResponse,
            type: 'SEMANTIC',
            score,
          };
        }

        if (score >= 0.88) {
          this.logger.debug(
            `[SmartCache] REFERENCE hit (score: ${score.toFixed(4)}) in ${Date.now() - startTime}ms`,
          );
          return {
            response: bestMatch.cachedResponse,
            type: 'SEMANTIC',
            score,
          };
        }
      }
    } catch (e) {
      if (e.message === 'Embedding timeout') {
        this.logger.warn(
          `[SmartCache] Semantic search timed out for query: "${query.substring(0, 30)}..."`,
        );
      } else {
        this.logger.error(`[SmartCache] Search failed: ${e.message}`);
      }
    }

    return { response: null, type: 'NONE' };
  }

  async personalize(
    cachedResponse: string,
    userData: { name: string; email?: string; orderId?: string },
    lastUserMessage: string,
  ): Promise<string> {
    // Handle Templates first
    if (cachedResponse === 'TEMPLATE:GREETING') {
      const name = userData.name || 'Customer';
      const hours = new Date().getHours();
      let greeting = 'Hello';
      if (hours < 12) greeting = 'Good morning';
      else if (hours < 17) greeting = 'Good afternoon';
      else greeting = 'Good evening';

      return `${greeting} ${name}! How can I help you today?`;
    }

    const transformer = AIModelFactory.create(this.configService, {
      provider: 'google',
      model: 'gemini-3-flash-preview', // Cheap and fast
    });

    const systemPrompt = `You are a text transformer. Below is a high-quality answer (The Source) to a similar question. Rewrite it for the New User (Target) by swapping personal details. Maintain the same factual accuracy, tone, and formatting. Output ONLY the final message.`;

    const userPrompt = `
      SOURCE ANSWER: ${cachedResponse}
      TARGET NAME: ${userData.name || 'Customer'}
      TARGET ORDER ID: ${userData.orderId || 'N/A'}
      USER'S LAST MESSAGE: ${lastUserMessage}
    `;

    const transformerStart = Date.now();
    try {
      const response = await transformer.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const content =
        typeof response.content === 'string'
          ? response.content
          : cachedResponse;

      // Log usage for transformation
      AiUsageService.logUsageAndDeduct({
        provider: 'google',
        modelName: 'gemini-3-flash-preview',
        inputTokens: AiUsageService.estimateTokens(systemPrompt + userPrompt),
        outputTokens: AiUsageService.estimateTokens(content),
        performanceMs: Date.now() - transformerStart,
        metadata: { type: 'smart-cache-personalization' },
      });

      return content;
    } catch (e) {
      this.logger.warn(
        `[SmartCache] Transformation failed, falling back to raw: ${e.message}`,
      );
      return cachedResponse;
    }
  }

  async store(
    query: string,
    response: string,
    organizationId: string,
    kbVersion?: string,
  ) {
    const embeddings = this.getEmbeddingsInstance();
    if (!embeddings) return;

    try {
      const org = await this.organizationsService.findOne(organizationId);
      const currentKbVersion = kbVersion || org?.aiKbVersion || 'v1';

      const storeStart = Date.now();
      const queryEmbedding = await embeddings.embedQuery(query);

      // Log usage for storage embedding
      AiUsageService.logUsageAndDeduct({
        provider: 'google',
        modelName: 'gemini-embedding-001',
        inputTokens: AiUsageService.estimateTokens(query),
        outputTokens: 0,
        performanceMs: Date.now() - storeStart,
        metadata: { type: 'cache-store-embedding' },
      });

      await this.smartCacheModel.create({
        organizationId: new Types.ObjectId(organizationId),
        rawQuery: query.trim().toLowerCase(),
        cachedResponse: response,
        queryEmbedding,
        kbVersion: currentKbVersion,
        metadata: { createdAt: new Date() },
      });

      // Also add to in-memory literal cache
      this.literalCache.set(
        `${organizationId}:${currentKbVersion}:${query.trim().toLowerCase()}`,
        response,
      );
    } catch (e) {
      this.logger.error(`[SmartCache] Storage failed: ${e.message}`);
    }
  }
}
