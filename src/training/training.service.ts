import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TrainingSource,
  TrainingSourceDocument,
} from './entities/training-source.entity';
import { CreateTrainingSourceDto } from './dto/create-training-source.dto';

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { convert } from 'html-to-text';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(TrainingSource.name)
    @InjectModel(TrainingSource.name)
    private trainingSourceModel: Model<TrainingSourceDocument>,
    private configService: ConfigService,
  ) {}

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
      try {
        const scraped = await this.scrapeUrl(sourceData.content);

        // Store metadata
        sourceData.metadata = {
          ...(sourceData.metadata || {}),
          originalUrl: sourceData.content,
          scrapedAt: new Date(),
        };

        // Replace URL with actual text content for the AI
        sourceData.content = scraped;

        // Update size estimate
        const kbSize = (scraped.length / 1024).toFixed(1);
        sourceData.size = `${kbSize} KB`;
      } catch (error) {
        console.error(`Failed to scrape URL ${sourceData.content}:`, error);
        // We throw so the frontend knows it failed
        throw new Error(
          `Failed to scrape content from ${sourceData.content}: ${error.message}`,
        );
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
    return createdSource.save();
  }

  private async scrapeUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    return convert(html, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'nav', format: 'skip' }, // Skip navigation menus typically
        { selector: 'footer', format: 'skip' }, // Skip footers typically
      ],
    });
  }

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

  async scanWebsite(url: string): Promise<any[]> {
    try {
      // Ensure URL has protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      const response = await fetch(url);
      const html = await response.text();

      const pages: { url: string; title: string; status: number }[] = [];
      const visitedUrls = new Set<string>();

      // Add the main page
      const titleMatch = /<title>(.*?)<\/title>/i.exec(html);
      const pageTitle = titleMatch ? titleMatch[1] : 'Home';

      visitedUrls.add(url);
      pages.push({
        url: url,
        title: pageTitle,
        status: response.status,
      });

      // Simple regex to find links (basic implementation)
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let match;

      const baseUrlObject = new URL(url);
      const origin = baseUrlObject.origin;

      while ((match = linkRegex.exec(html)) !== null) {
        if (pages.length >= 50) break; // Limit to 50 pages

        const href = match[1];
        let linkText = match[2].replace(/<[^>]*>/g, '').trim(); // Strip HTML tags from link text

        try {
          // Resolve relative URLs
          const fullUrl = new URL(href, url);

          // Only include internal links that match the origin
          if (
            fullUrl.origin === origin &&
            !visitedUrls.has(fullUrl.toString())
          ) {
            // Filter out files, anchors, etc
            if (fullUrl.pathname.match(/\.(jpg|jpeg|png|gif|pdf|css|js)$/i))
              continue;

            visitedUrls.add(fullUrl.toString());

            // Use the path as title if text is empty or generic
            if (!linkText || linkText.length > 50) {
              linkText = fullUrl.pathname === '/' ? 'Home' : fullUrl.pathname;
            }

            pages.push({
              url: fullUrl.toString(),
              title: linkText,
              status: 200, // We assume 200 for discovered links for now
            });
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }

      return pages;
    } catch (error) {
      throw new Error(`Failed to scan website: ${error.message}`);
    }
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
      type: 'file',
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
    return createdSource.save();
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
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }
    } catch (error) {
      throw new Error(`Failed to parse file: ${error.message}`);
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) return [];

      const apiKey = this.configService.get<string>('ai.geminiApiKey');
      if (!apiKey) {
        console.warn('Gemini API key not found, skipping embedding generation');
        return [];
      }

      const embeddings = new GoogleGenerativeAIEmbeddings({
        modelName: 'embedding-001', // or text-embedding-004
        apiKey,
      });

      return await embeddings.embedQuery(text);
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      return []; // Return empty array on failure to avoid blocking creation
    }
  }
}
