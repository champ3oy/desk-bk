import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TrainingSource,
  TrainingSourceDocument,
} from './entities/training-source.entity';
import { CreateTrainingSourceDto } from './dto/create-training-source.dto';
import { ScraperService } from './scraper.service';
import { OrganizationsService } from '../organizations/organizations.service';
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
    private organizationsService: OrganizationsService,
  ) {
    this.logger.log('TrainingService initialized with ElevenLabs integration.');
  }

  async create(
    createTrainingSourceDto: CreateTrainingSourceDto,
    organizationId: string,
  ): Promise<TrainingSource> {
    const sourceData: any = { ...createTrainingSourceDto };

    // Check for URL type processing
    const isUrl =
      sourceData.type === 'url' &&
      sourceData.content &&
      (sourceData.content.startsWith('http') ||
        sourceData.content.startsWith('https'));

    if (isUrl) {
      sourceData.status = 'processing';
      sourceData.size = 'Pending';
    } else {
      sourceData.status = 'completed';
    }

    // Generate embedding for Text type immediately
    let embedding: number[] | undefined;
    if (
      !isUrl &&
      sourceData.content &&
      sourceData.type !== 'file' &&
      sourceData.type !== 'image'
    ) {
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
        status: savedSource.status,
      })}`,
    );

    // Trigger background processing for URL
    if (isUrl) {
      this.processUrlAsync(savedSource, organizationId);
    }
    // For text/manual content, add to ElevenLabs immediately
    else if (savedSource.content) {
      this.syncToElevenLabs(savedSource, organizationId);
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

  async removeMany(ids: string[], organizationId: string): Promise<void> {
    const result = await this.trainingSourceModel.deleteMany({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
      organizationId: new Types.ObjectId(organizationId),
    });

    if (result.deletedCount === 0) {
      this.logger.warn(
        `No training sources found to delete for ids: ${ids.join(', ')}`,
      );
    } else {
      this.logger.log(`Deleted ${result.deletedCount} training sources`);
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
    // Create initial source with 'processing' status
    const sourceData: any = {
      name: file.originalname,
      type: file.mimetype.startsWith('image/')
        ? 'image'
        : file.mimetype.startsWith('video/')
          ? 'video'
          : file.mimetype.startsWith('audio/')
            ? 'audio'
            : 'file',
      content: '', // Parsed later
      size: (file.size / 1024).toFixed(1) + ' KB',
      metadata: {
        mimetype: file.mimetype,
        originalName: file.originalname,
      },
      status: 'processing',
    };

    const createdSource = new this.trainingSourceModel({
      ...sourceData,
      organizationId: new Types.ObjectId(organizationId),
    });
    const savedSource = await createdSource.save();

    // Trigger background processing
    this.processFileAsync(file, savedSource, organizationId);

    return savedSource;
  }

  private async syncToElevenLabs(
    source: TrainingSourceDocument,
    organizationId: string,
  ) {
    if (!source.content) return;
    try {
      this.logger.log(
        `Adding content to ElevenLabs for source: ${source.name}`,
      );

      let agentId: string | undefined;
      try {
        const org = await this.organizationsService.findOne(organizationId);
        if (org?.elevenLabsAgentId) {
          agentId = org.elevenLabsAgentId;
          this.logger.log(`Using Organization specific Agent ID: ${agentId}`);
        }
      } catch (orgErr) {
        this.logger.warn(
          `Failed to fetch org for agent ID lookup: ${orgErr.message}`,
        );
      }

      await this.elevenLabsService.addToKnowledgeBase(
        source.name || (source.content as string).substring(0, 50),
        source.content as string,
        'text',
        agentId,
      );
      this.logger.log('ElevenLabs synchronization triggered.');
    } catch (error) {
      this.logger.error(
        `ElevenLabs sync failed for source ${source._id}: ${error.message}`,
      );
    }
  }

  private async processUrlAsync(
    source: TrainingSourceDocument,
    organizationId: string,
  ) {
    if (this.configService.get<boolean>('ai.webDisableScraping')) {
      this.logger.warn(`Scraping disabled, skipping ${source.name}`);
      source.content = `[Scraping Disabled] ${source.name}`; // original url was in content potentially
      source.status = 'failed';
      await source.save();
      return;
    }

    try {
      const url = source.content || source.metadata?.originalUrl;
      if (!url) throw new Error('No URL to scrape');

      this.logger.log(`Background Scraping URL: ${url}`);
      const scrapedPage = await this.scraperService.scrapeUrl(url);

      source.metadata = {
        ...(source.metadata || {}),
        originalUrl: url,
        scrapedAt: scrapedPage.metadata.scrapedAt,
        loadTimeMs: scrapedPage.metadata.loadTimeMs,
        title: scrapedPage.title,
      };
      source.content = scrapedPage.content;
      const kbSize = (scrapedPage.content.length / 1024).toFixed(1);
      source.size = `${kbSize} KB`;
      source.embedding = await this.generateEmbedding(source.content);
      source.status = 'completed';

      await source.save();
      this.logger.log(`Background scraping completed for ${source._id}`);

      await this.syncToElevenLabs(source, organizationId);
    } catch (error) {
      this.logger.error(`Background scraping failed: ${error.message}`);
      source.status = 'failed';
      source.metadata = { ...(source.metadata || {}), error: error.message };
      await source.save();
    }
  }

  private async processFileAsync(
    file: Express.Multer.File,
    source: TrainingSourceDocument,
    organizationId: string,
  ) {
    try {
      const content = await this.parseFileContent(file);
      source.content = content;
      source.embedding = await this.generateEmbedding(content);
      source.status = 'completed';

      await source.save();

      await this.syncToElevenLabs(source, organizationId);
      this.logger.log(`Background file processing completed for ${source._id}`);
    } catch (error) {
      this.logger.error(`Background file processing failed: ${error.message}`);
      source.status = 'failed';
      source.metadata = { ...(source.metadata || {}), error: error.message };
      await source.save();
    }
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
      } else if (file.mimetype.startsWith('video/')) {
        return this.analyzeVideo(file);
      } else if (file.mimetype.startsWith('audio/')) {
        return this.analyzeAudio(file);
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }
    } catch (error) {
      throw new Error(`Failed to parse file: ${error.message}`);
    }
  }

  private async analyzeVideo(file: Express.Multer.File): Promise<string> {
    try {
      this.logger.log(
        `Analyzing video: ${file.originalname} (${file.mimetype})`,
      );

      const model = AIModelFactory.create(this.configService);
      const base64Data = file.buffer.toString('base64');

      const message = new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Watch this video carefully. Extract all spoken words as a transcript, and provide a detailed description of the visual content, including any text seen on screen, people, actions, and key events. Format the output as a comprehensive technical document suitable for a knowledge base.',
          },
          {
            // @ts-ignore - LangChain's Google GenAI supports media type for video/audio
            type: 'media',
            mimeType: file.mimetype,
            data: base64Data,
          },
        ],
      });

      const response = await model.invoke([message]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(
        `Failed to analyze video ${file.originalname}: ${error.message}`,
      );
      throw new Error(`Failed to analyze video: ${error.message}`);
    }
  }

  private async analyzeAudio(file: Express.Multer.File): Promise<string> {
    try {
      this.logger.log(
        `Analyzing audio: ${file.originalname} (${file.mimetype})`,
      );

      const model = AIModelFactory.create(this.configService);
      const base64Data = file.buffer.toString('base64');

      const message = new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Listen to this audio carefully. Provide a full, accurate transcript of everything said. If there are multiple speakers, try to distinguish them. Also describe any significant background sounds or context if relevant.',
          },
          {
            // @ts-ignore
            type: 'media',
            mimeType: file.mimetype,
            data: base64Data,
          },
        ],
      });

      const response = await model.invoke([message]);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (error) {
      this.logger.error(
        `Failed to analyze audio ${file.originalname}: ${error.message}`,
      );
      throw new Error(`Failed to analyze audio: ${error.message}`);
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
