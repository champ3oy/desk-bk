import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Logger } from '@nestjs/common';
import { CustomLLMClient } from './custom-llm.client';

export class AIModelFactory {
  private static readonly logger = new Logger('AIModelFactory');

  static create(
    configService: ConfigService,
    options?: { provider?: string; model?: string },
  ): BaseChatModel {
    const envModel = process.env.AI_MODEL;
    const configModel = configService.get<string>('ai.model');

    // Determine the provider and model to use
    // If options are provided, they take precedence
    let provider = options?.provider;
    let modelName = options?.model;

    // If not specified via options, infer from env/config
    if (!provider || !modelName) {
      const defaultModel = envModel || configModel || 'gemini-2.0-flash-exp';
      if (defaultModel.toLowerCase() === 'custom') {
        provider = 'custom';
        modelName =
          configService.get<string>('ai.customModelName') ||
          process.env.AI_CUSTOM_MODEL_NAME;
      } else {
        provider = 'google';
        modelName = defaultModel;
      }
    }

    // Sanitize and ensure string
    modelName = (modelName || '').trim().replace(/^['"]|['"]$/g, '');

    const isCustom = provider?.toLowerCase() === 'custom';

    this.logger.log(
      `[AI Factory] Using Model: '${modelName}' Provider: '${provider}'`,
    );

    if (isCustom) {
      return this.createCustomClient(configService, modelName);
    }

    return this.createGeminiClient(configService, modelName);
  }

  static getAvailableModels(configService: ConfigService): Array<{
    provider: string;
    model: string;
    label: string;
  }> {
    const models: Array<{
      provider: string;
      model: string;
      label: string;
    }> = [];

    // Check Google/Gemini
    const googleKey =
      configService.get<string>('ai.geminiApiKey') ||
      process.env.APPLE_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (googleKey) {
      models.push(
        {
          provider: 'google',
          model: 'gemini-2.0-flash-exp',
          label: 'Gemini 2.0 Flash (Exp)',
        },
        {
          provider: 'google',
          model: 'gemini-1.5-flash',
          label: 'Gemini 1.5 Flash',
        },
        {
          provider: 'google',
          model: 'gemini-1.5-pro',
          label: 'Gemini 1.5 Pro',
        },
        {
          provider: 'google',
          model: 'gemini-3-pro-preview',
          label: 'Gemini 3.0 Pro Preview',
        },
        {
          provider: 'google',
          model: 'gemini-3-flash-preview',
          label: 'Gemini 3.0 Flash Preview',
        },
        {
          provider: 'google',
          model: 'gemini-2.5-pro',
          label: 'Gemini 2.5 Pro',
        },
        {
          provider: 'google',
          model: 'gemini-2.5-flash',
          label: 'Gemini 2.5 Flash',
        },
      );
    }

    // Check Custom
    const customBaseUrl =
      configService.get<string>('ai.customBaseUrl') ||
      process.env.AI_CUSTOM_BASE_URL;
    const customApiKey =
      configService.get<string>('ai.customApiKey') ||
      process.env.AI_CUSTOM_API_KEY;
    const customModelName =
      configService.get<string>('ai.customModelName') ||
      process.env.AI_CUSTOM_MODEL_NAME;

    if (customBaseUrl && customApiKey) {
      models.push({
        provider: 'custom',
        model: customModelName || 'custom-model',
        label: `Custom (${customModelName || 'Unknown'})`,
      });
    }

    return models;
  }

  private static createCustomClient(
    configService: ConfigService,
    modelNameOverride?: string,
  ): CustomLLMClient {
    const customBaseUrl =
      configService.get<string>('ai.customBaseUrl') ||
      process.env.AI_CUSTOM_BASE_URL;
    const customApiKey =
      configService.get<string>('ai.customApiKey') ||
      process.env.AI_CUSTOM_API_KEY;
    const customModelName =
      configService.get<string>('ai.customModelName') ||
      process.env.AI_CUSTOM_MODEL_NAME;

    // Use override if provided, otherwise config
    const effectiveModelName = modelNameOverride || customModelName;

    this.logger.log(`[AI Factory] Custom Client Configuration:`);
    this.logger.log(`  - Base URL: ${customBaseUrl}`);
    this.logger.log(`  - Model Name: ${effectiveModelName}`);
    this.logger.log(
      `  - API Key: ${customApiKey ? '***' + customApiKey.slice(-4) : 'NOT SET'}`,
    );

    if (!customBaseUrl && !customApiKey) {
      throw new Error(
        'Custom AI configuration missing. Please set AI_CUSTOM_BASE_URL and AI_CUSTOM_API_KEY.',
      );
    }

    // Use our custom client that handles non-standard authentication
    return new CustomLLMClient({
      baseUrl: customBaseUrl || 'http://localhost:3000', // Default backup
      apiKey: customApiKey || '',
      modelName: effectiveModelName || 'default-model',
      temperature: 0.3,
    });
  }

  private static createGeminiClient(
    configService: ConfigService,
    modelName: string,
  ): ChatGoogleGenerativeAI {
    const apiKey =
      configService.get<string>('ai.geminiApiKey') ||
      process.env.APPLE_API_KEY ||
      process.env.GOOGLE_API_KEY; // Fallback

    if (!apiKey) {
      throw new Error(
        'Gemini API key is not configured. Please set GEMINI_API_KEY.',
      );
    }

    this.logger.log(`[AI Factory] Initializing Gemini Client: ${modelName}`);

    return new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey,
      temperature: 0.3,
    });
  }
}
