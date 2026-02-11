import { ChatVertexAI } from '@langchain/google-vertexai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Logger } from '@nestjs/common';
import { CustomLLMClient } from './custom-llm.client';

export class AIModelFactory {
  private static readonly logger = new Logger('AIModelFactory');

  // Cache model instances to avoid recreation overhead
  private static readonly modelCache = new Map<string, BaseChatModel>();

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
      const defaultModel = envModel || configModel || 'gemini-3-flash-preview';
      if (defaultModel.toLowerCase() === 'custom') {
        provider = 'custom';
        modelName =
          configService.get<string>('ai.customModelName') ||
          process.env.AI_CUSTOM_MODEL_NAME;
      } else if (defaultModel.toLowerCase().startsWith('gpt')) {
        provider = 'openai';
        modelName = defaultModel;
      } else if (defaultModel.toLowerCase().startsWith('deepseek')) {
        provider = 'deepseek';
        modelName = defaultModel;
      } else if (
        process.env.AI_PROVIDER === 'vertex' ||
        defaultModel.toLowerCase().startsWith('vertex/')
      ) {
        provider = 'vertex';
        modelName = defaultModel.replace(/^vertex\//i, '');
      } else {
        provider = 'google';
        modelName = defaultModel;
      }
    }

    // Sanitize and ensure string
    modelName = (modelName || '').trim().replace(/^['"]|['"]$/g, '');

    const isCustom = provider?.toLowerCase() === 'custom';

    // Map 'gemma3' to the specific model version 'gemma3:4b' required by the custom provider
    if (isCustom && modelName === 'gemma3') {
      modelName = 'gemma3:4b';
    }

    // Check for cached model with rotated key consideration
    let selectedApiKey: string | undefined;
    let apiKeyHash = '';

    // Pre-resolve API Key for rotation
    const isGoogle = !provider || provider.toLowerCase() === 'google';
    const isVertex = provider?.toLowerCase() === 'vertex';

    if (isGoogle || isVertex) {
      const configKey = isGoogle ? 'ai.geminiApiKey' : 'ai.vertexApiKey';
      const allKeys = (configService.get<string>(configKey) || '').split(',');

      if (allKeys.length > 1) {
        // Pick a random key from the list
        const randomIndex = Math.floor(Math.random() * allKeys.length);
        selectedApiKey = allKeys[randomIndex].trim();
        apiKeyHash = `:${randomIndex}`; // Append index to cache key
      } else if (allKeys.length === 1 && allKeys[0].trim()) {
        selectedApiKey = allKeys[0].trim();
      }
    }

    // Check cache first
    const cacheKey = `${provider}:${modelName}${apiKeyHash}`;
    const cachedModel = this.modelCache.get(cacheKey);
    if (cachedModel) {
      this.logger.debug(
        `[AI Factory] Using cached model: '${modelName}' Provider: '${provider}'`,
      );
      return cachedModel;
    }

    this.logger.log(
      `[AI Factory] Creating new model: '${modelName}' Provider: '${provider}'`,
    );

    let model: BaseChatModel;
    if (provider?.toLowerCase() === 'google') {
      model = this.createGeminiClient(configService, modelName, selectedApiKey);
    } else {
      model = this.createModelInstance(
        configService,
        provider,
        modelName,
        selectedApiKey,
      );
    }

    // Cache the model instance
    this.modelCache.set(cacheKey, model);

    return model;
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
    const googleKey = configService.get<string>('ai.geminiApiKey');

    if (googleKey) {
      // If comma separated, just check if at least one exists
      models.push(
        {
          provider: 'google',
          model: 'gemini-3-pro-preview',
          label: 'Gemini 3.0 Pro (Preview)',
        },
        {
          provider: 'google',
          model: 'gemini-3-flash-preview',
          label: 'Gemini 3.0 Flash (Preview)',
        },
        {
          provider: 'google',
          model: 'gemini-2.5-flash',
          label: 'Gemini 2.5 Flash',
        },
        {
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          label: 'Gemini 2.5 Flash Lite',
        },
      );
    }

    // Check Vertex AI
    const vertexKey = configService.get<string>('ai.vertexApiKey');

    if (vertexKey) {
      models.push(
        {
          provider: 'vertex',
          model: 'gemini-1.5-pro',
          label: 'Vertex Gemini 1.5 Pro',
        },
        {
          provider: 'vertex',
          model: 'gemini-1.5-flash',
          label: 'Vertex Gemini 1.5 Flash',
        },
      );
    }

    // Check Deepseek
    const deepseekKey =
      configService.get<string>('ai.deepseekApiKey') ||
      process.env.DEEPSEEK_API_KEY;

    if (deepseekKey) {
      models.push(
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          label: 'Deepseek Chat (V3)',
        },
        {
          provider: 'deepseek',
          model: 'deepseek-reasoner',
          label: 'Deepseek Reasoner (R1)',
        },
      );
    }

    // Check OpenAI
    const openaiKey =
      configService.get<string>('ai.openaiApiKey') ||
      process.env.OPENAI_API_KEY;

    if (openaiKey) {
      models.push(
        {
          provider: 'openai',
          model: 'gpt-4o',
          label: 'GPT-4o',
        },
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          label: 'GPT-4o Mini',
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

  private static createModelInstance(
    configService: ConfigService,
    provider: string | undefined,
    modelName: string,
    apiKeyOverride?: string,
  ): BaseChatModel {
    const p = provider?.toLowerCase();
    if (p === 'custom') {
      return this.createCustomClient(configService, modelName);
    } else if (p === 'deepseek') {
      return this.createDeepseekClient(configService, modelName);
    } else if (p === 'openai') {
      return this.createOpenAIClient(configService, modelName);
    } else if (p === 'google') {
      return this.createBaseGeminiClient(
        configService,
        modelName,
        apiKeyOverride,
      );
    } else if (p === 'vertex') {
      return this.createVertexAIClient(
        configService,
        modelName,
        apiKeyOverride,
      );
    }

    // Default inference if provider is not explicitly set or recognized
    if (modelName.toLowerCase().startsWith('gpt')) {
      return this.createOpenAIClient(configService, modelName);
    } else if (modelName.toLowerCase().startsWith('deepseek')) {
      return this.createDeepseekClient(configService, modelName);
    }

    return this.createBaseGeminiClient(
      configService,
      modelName,
      apiKeyOverride,
    );
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
    apiKeyOverride?: string,
  ): BaseChatModel {
    const primary = this.createBaseGeminiClient(
      configService,
      modelName,
      apiKeyOverride,
    );

    // Determine fallbacks
    const fallbackModelNames: string[] = [];

    // 1. Check for specific smart fallbacks
    if (modelName === 'gemini-3-pro-preview') {
      fallbackModelNames.push('gemini-2.5-flash');
    } else if (modelName === 'gemini-3-flash-preview') {
      fallbackModelNames.push('gemini-2.5-flash');
    }

    // Remove duplicates and self
    const uniqueFallbacks = [...new Set(fallbackModelNames)].filter(
      (m) => m !== modelName,
    );

    if (uniqueFallbacks.length > 0) {
      this.logger.log(
        `[AI Factory] Adding fallbacks for ${modelName}: ${uniqueFallbacks.join(', ')}`,
      );
      return primary.withFallbacks({
        fallbacks: uniqueFallbacks.map((m) =>
          this.createModelInstance(configService, undefined, m, apiKeyOverride),
        ),
      }) as any;
    }

    return primary;
  }

  private static createBaseGeminiClient(
    configService: ConfigService,
    modelName: string,
    apiKeyOverride?: string,
  ): ChatGoogleGenerativeAI {
    const apiKey =
      apiKeyOverride || configService.get<string>('ai.geminiApiKey');

    if (!apiKey) {
      throw new Error(
        'Gemini API key is not configured. Please set GEMINI_API_KEY.',
      );
    }

    this.logger.log(`[AI Factory] Initializing Gemini Client: ${modelName}`);

    const client = new ChatGoogleGenerativeAI({
      model: modelName,
      apiKey,
      temperature: 0.3,
      maxRetries: 0, // Fail fast on rate limits to trigger fallbacks
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE',
        },
      ] as any,
    });

    // We override invoke to wrap it in our semaphore for the whole application
    // This prevents background jobs from hitting concurrency limits
    const originalInvoke = client.invoke.bind(client);
    client.invoke = ((...args: any[]) => {
      // Import here to avoid circular dependency or init order issues

      const { geminiSemaphore } = require('./concurrency-semaphore');
      return geminiSemaphore.run(() => originalInvoke(...args));
    }) as any;

    return client;
  }

  private static createVertexAIClient(
    configService: ConfigService,
    modelName: string,
    apiKeyOverride?: string,
  ): ChatVertexAI {
    const apiKey =
      apiKeyOverride || configService.get<string>('ai.vertexApiKey');

    if (!apiKey) {
      throw new Error(
        'Vertex AI API key is not configured. Please set VERTEX_API_KEY (or VERTEX_AI_KEY).',
      );
    }

    this.logger.log(`[AI Factory] Initializing Vertex AI Client: ${modelName}`);

    return new ChatVertexAI({
      model: modelName,
      apiKey: apiKey,
      temperature: 0.3,
    });
  }

  private static createDeepseekClient(
    configService: ConfigService,
    modelName: string,
  ): ChatOpenAI {
    const apiKey =
      configService.get<string>('ai.deepseekApiKey') ||
      process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Deepseek API key is not configured. Please set DEEPSEEK_API_KEY.',
      );
    }

    this.logger.log(`[AI Factory] Initializing Deepseek Client: ${modelName}`);

    return new ChatOpenAI({
      modelName: modelName,
      apiKey: apiKey,
      configuration: {
        baseURL: 'https://api.deepseek.com',
      },
      temperature: 0.3,
    });
  }

  private static createOpenAIClient(
    configService: ConfigService,
    modelName: string,
  ): ChatOpenAI {
    const apiKey =
      configService.get<string>('ai.openaiApiKey') ||
      process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OpenAI API key is not configured. Please set OPENAI_API_KEY.',
      );
    }

    this.logger.log(`[AI Factory] Initializing OpenAI Client: ${modelName}`);

    return new ChatOpenAI({
      modelName: modelName,
      apiKey: apiKey,
      temperature: 0.3,
    });
  }
}
