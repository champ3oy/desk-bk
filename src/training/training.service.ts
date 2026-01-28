import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TrainingSource,
  TrainingSourceDocument,
} from './entities/training-source.entity';
import { CreateTrainingSourceDto } from './dto/create-training-source.dto';
import { ScraperService } from './scraper.service';
import { ElevenLabsService } from '../integrations/elevenlabs/elevenlabs.service';

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { AIModelFactory } from '../ai/ai-model.factory';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class TrainingService {
  private readonly logger = new Logger(TrainingService.name);

  constructor(
    @InjectModel(TrainingSource.name)
    private trainingSourceModel: Model<TrainingSourceDocument>,
    private configService: ConfigService,
    private scraperService: ScraperService,
    private elevenLabsService: ElevenLabsService,
  ) {
    this.logger.log('TrainingService initialized with ElevenLabs integration.');
  }

  async create(
    createTrainingSourceDto: CreateTrainingSourceDto,
    organizationId: string,
  ): Promise<TrainingSource> {
    const sourceData: any = { ...createTrainingSourceDto };

    // Auto-scrape content if type is 'url' and content looks like a URL
    if (
      sourceData.type === 'url' &&
      sourceData.content &&
      (sourceData.content.startsWith('http') ||
        sourceData.content.startsWith('https'))
    ) {
      // Check if scraping is disabled in this environment
      if (this.configService.get<boolean>('ai.webDisableScraping')) {
        this.logger.warn(
          `Scraping is disabled in this environment. Skipping URL: ${sourceData.content}`,
        );
        sourceData.content = `[Scraping Disabled] ${sourceData.content}`;
        sourceData.size = '0 KB';
      } else {
        try {
          this.logger.log(`Scraping URL: ${sourceData.content}`);
          const scrapedPage = await this.scraperService.scrapeUrl(
            sourceData.content,
          );

          // Store metadata
          sourceData.metadata = {
            ...(sourceData.metadata || {}),
            originalUrl: sourceData.content,
            scrapedAt: scrapedPage.metadata.scrapedAt,
            loadTimeMs: scrapedPage.metadata.loadTimeMs,
            title: scrapedPage.title,
          };

          // Replace URL with actual text content for the AI
          sourceData.content = scrapedPage.content;

          // Update size estimate
          const kbSize = (scrapedPage.content.length / 1024).toFixed(1);
          sourceData.size = `${kbSize} KB`;

          this.logger.log(
            `Scraped ${sourceData.content.length} chars from ${sourceData.metadata.originalUrl}`,
          );
        } catch (error) {
          console.error(`Failed to scrape URL ${sourceData.content}:`, error);
          // We throw so the frontend knows it failed
          throw new Error(
            `Failed to scrape content from ${sourceData.content}: ${error.message}`,
          );
        }
      }
    }

    // Generate embedding
    let embedding: number[] | undefined;
    if (sourceData.content) {
      embedding = await this.generateEmbedding(sourceData.content);
    }

    const createdSource = new this.trainingSourceModel({
      ...sourceData,
      embedding,
      organizationId: new Types.ObjectId(organizationId),
    });
    const savedSource = await createdSource.save();

    this.logger.log(
      `Created training source: ${JSON.stringify({
        id: savedSource._id,
        name: savedSource.name,
        type: savedSource.type,
        hasContent: !!savedSource.content,
      })}`,
    );

    // Add to ElevenLabs Knowledge Base
    if (savedSource.content) {
      try {
        this.logger.log(
          `Adding content to ElevenLabs for source: ${savedSource.name}`,
        );
        await this.elevenLabsService.addToKnowledgeBase(
          savedSource.name || (savedSource.content as string).substring(0, 50),
          savedSource.content as string,
          'text',
        );
        this.logger.log('ElevenLabs synchronization triggered.');
      } catch (error) {
        this.logger.error(`ElevenLabs sync failed: ${error.message}`);
      }
    }

    return savedSource;
  }

  // Scraping is now handled by ScraperService (Playwright-based)

  async findAll(organizationId: string): Promise<TrainingSource[]> {
    return this.trainingSourceModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string, organizationId: string): Promise<TrainingSource> {
    const source = await this.trainingSourceModel.findOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!source) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }

    return source;
  }

  async update(
    id: string,
    updateDto: Partial<CreateTrainingSourceDto>,
    organizationId: string,
  ): Promise<TrainingSource> {
    const source = await this.trainingSourceModel.findOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (!source) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }

    // If content changed, regenerate embedding
    if (updateDto.content) {
      (updateDto as any).embedding = await this.generateEmbedding(
        updateDto.content,
      );
    }

    Object.assign(source, updateDto);
    return source.save();
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.trainingSourceModel.deleteOne({
      _id: id,
      organizationId: new Types.ObjectId(organizationId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException(`Training source with ID ${id} not found`);
    }
  }

  /**
   * Scan a website and discover all pages (uses Playwright crawler)
   */
  async scanWebsite(url: string, maxPages: number = 50): Promise<any[]> {
    if (this.configService.get<boolean>('ai.webDisableScraping')) {
      this.logger.warn(
        `Website scanning is disabled in this environment. Skipping scan for: ${url}`,
      );
      return [];
    }
    this.logger.log(`Scanning website: ${url}`);
    return this.scraperService.scanWebsite(url, maxPages);
  }
  async findSimilar(
    embedding: number[],
    organizationId: string,
    limit: number = 3,
  ): Promise<any[]> {
    return this.trainingSourceModel
      .aggregate([
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'embedding',
            queryVector: embedding,
            numCandidates: limit * 10,
            limit: limit,
            filter: {
              organizationId: new Types.ObjectId(organizationId),
            },
          },
        },
        {
          $project: {
            name: 1,
            content: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .exec();
  }

  async processFile(
    file: Express.Multer.File,
    organizationId: string,
  ): Promise<TrainingSource> {
    const content = await this.parseFileContent(file);

    const sourceData: any = {
      name: file.originalname,
      type: file.mimetype.startsWith('image/') ? 'image' : 'file',
      content,
      size: (file.size / 1024).toFixed(1) + ' KB',
      metadata: {
        mimetype: file.mimetype,
        originalName: file.originalname,
      },
    };

    // Generate embedding
    let embedding: number[] | undefined;
    if (content) {
      embedding = await this.generateEmbedding(content);
    }

    const createdSource = new this.trainingSourceModel({
      ...sourceData,
      embedding,
      organizationId: new Types.ObjectId(organizationId),
    });
    const savedSource = await createdSource.save();

    // Add to ElevenLabs Knowledge Base
    if (content) {
      try {
        await this.elevenLabsService.addToKnowledgeBase(
          file.originalname,
          content,
          'text',
        );
      } catch (error) {
        this.logger.error(`ElevenLabs sync failed for file: ${error.message}`);
      }
    }

    return savedSource;
  }

  private async parseFileContent(file: Express.Multer.File): Promise<string> {
    try {
      if (file.mimetype === 'application/pdf') {
        const parser = new PDFParse({ data: file.buffer });
        const result = await parser.getText();
        return result.text;
      } else if (
        file.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'application/msword'
      ) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        return result.value;
      } else if (
        file.mimetype === 'text/plain' ||
        file.mimetype === 'text/csv' ||
        file.mimetype === 'application/json'
      ) {
        return file.buffer.toString('utf-8');
      } else if (file.mimetype.startsWith('image/')) {
        return this.analyzeImage(file);
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }
    } catch (error) {
      throw new Error(`Failed to parse file: ${error.message}`);
    }
  }

  private async analyzeImage(file: Express.Multer.File): Promise<string> {
    try {
      this.logger.log(
        `Analyzing image: ${file.originalname} (${file.mimetype})`,
      );

      const model = AIModelFactory.create(this.configService);

      const base64Image = file.buffer.toString('base64');

      const message = new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Analyze this image for a knowledge base. Extract all visible text (OCR) and provide a detailed technical description of any diagrams, charts, or visual information. Format the output clearly so it can be indexed for semantic search.',
          },
          {
            type: 'image_url',
            image_url: `data:${file.mimetype};base64,${base64Image}`,
          },
        ],
      });

      const response = await model.invoke([message]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(
        `Failed to analyze image ${file.originalname}: ${error.message}`,
      );
      throw new Error(`Failed to analyze image: ${error.message}`);
    }
  }

  // Cached embeddings instance (singleton pattern)
  private embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

  private getEmbeddingsInstance(): GoogleGenerativeAIEmbeddings | null {
    if (this.embeddingsInstance) {
      return this.embeddingsInstance;
    }

    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    if (!apiKey) {
      console.warn('Gemini API key not found, skipping embedding generation');
      return null;
    }

    this.embeddingsInstance = new GoogleGenerativeAIEmbeddings({
      modelName: 'gemini-embedding-001',
      apiKey,
    });

    return this.embeddingsInstance;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) return [];

      const embeddings = this.getEmbeddingsInstance();
      if (!embeddings) {
        return [];
      }

      return await embeddings.embedQuery(text);
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return []; // Return empty array on failure to avoid blocking creation
    }
  }
}
