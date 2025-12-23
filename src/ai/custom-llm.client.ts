import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatResult, ChatGeneration } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { Logger } from '@nestjs/common';

interface CustomLLMConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
}

interface CustomChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CustomChatRequest {
  model: string;
  messages: CustomChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface CustomChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Custom LLM client for non-OpenAI-compatible APIs
 * Handles custom authentication and endpoint structures
 */
export class CustomLLMClient extends BaseChatModel {
  private static readonly logger = new Logger('CustomLLMClient');

  private baseUrl: string;
  private apiKey: string;
  private modelName: string;
  private temperature: number;

  constructor(config: CustomLLMConfig) {
    super({});
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.modelName = config.modelName;
    this.temperature = config.temperature ?? 0.3;

    CustomLLMClient.logger.log(`[Custom LLM] Initialized with:`);
    CustomLLMClient.logger.log(`  - Base URL: ${this.baseUrl}`);
    CustomLLMClient.logger.log(`  - Model: ${this.modelName}`);
  }

  _llmType(): string {
    return 'custom-llm';
  }

  async _generate(
    messages: BaseMessage[],
    options?: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    // Convert LangChain messages to custom API format
    const customMessages: CustomChatMessage[] = messages.map((msg) => {
      let role: 'system' | 'user' | 'assistant';

      if (msg instanceof SystemMessage) {
        role = 'system';
      } else if (msg instanceof HumanMessage) {
        role = 'user';
      } else if (msg instanceof AIMessage) {
        role = 'assistant';
      } else {
        role = 'user'; // fallback
      }

      return {
        role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      };
    });

    const requestBody: CustomChatRequest = {
      model: this.modelName,
      messages: customMessages,
      temperature: this.temperature,
      max_tokens: 2000,
    };

    CustomLLMClient.logger.debug(
      `[Custom LLM] Request to ${this.baseUrl}/chat`,
    );
    CustomLLMClient.logger.debug(
      `[Custom LLM] Messages: ${customMessages.length} messages`,
    );

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey, // Custom auth header
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        CustomLLMClient.logger.error(
          `[Custom LLM] API Error (${response.status}): ${errorText}`,
        );
        throw new Error(
          `Custom LLM API error: ${response.status} - ${errorText}`,
        );
      }

      const data: any = await response.json();

      CustomLLMClient.logger.debug(
        `[Custom LLM] Raw API Response: ${JSON.stringify(data)}`,
      );

      // Handle standard Open-AI like format
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        const content = data.choices[0].message.content;
        return {
          generations: [{ text: content, message: new AIMessage(content) }],
          llmOutput: { tokenUsage: data.usage },
        };
      }

      // Handle "response" or "text" fields (Ollama raw, etc)
      if (data.response) {
        return {
          generations: [
            { text: data.response, message: new AIMessage(data.response) },
          ],
          llmOutput: {},
        };
      }

      if (data.content) {
        return {
          generations: [
            { text: data.content, message: new AIMessage(data.content) },
          ],
          llmOutput: {},
        };
      }

      throw new Error('Unknown response format from Custom LLM API');

      // Removed unreachable code
    } catch (error) {
      CustomLLMClient.logger.error(`[Custom LLM] Request failed:`, error);
      throw error;
    }
  }

  // Required by BaseChatModel but not used in our implementation
  _combineLLMOutput() {
    return {};
  }
}
