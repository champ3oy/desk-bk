# Custom LLM Client Implementation

## Overview

Created a centralized AI model factory to support both Google Gemini and custom OpenAI-compatible LLM providers (like your Llama 3.1 instance).

## Architecture

### AIModelFactory (`src/ai/ai-model.factory.ts`)

A factory class that handles the creation of AI model clients based on environment configuration.

**Features:**

- Automatic detection of custom vs. Gemini models
- Direct environment variable access to avoid config parsing issues
- Comprehensive logging for debugging
- Centralized error handling

**Configuration:**

```env
# For Custom LLM (OpenAI-compatible API)
AI_MODEL=custom
AI_CUSTOM_BASE_URL=https://aii.bsai.cloud/api/v1
AI_CUSTOM_API_KEY=your-api-key
AI_CUSTOM_MODEL_NAME=gemma3:4b

# For Google Gemini (default)
AI_MODEL=gemini-2.0-flash-exp
GOOGLE_API_KEY=your-gemini-key
```

### Updated Components

All AI agents now use the `AIModelFactory`:

1. **Response Agent** (`src/ai/agents/response/index.ts`)
   - Drafts customer support responses
   - Uses organization-specific personality settings
   - Integrates with knowledge base

2. **Summary Agent** (`src/ai/agents/summary/index.ts`)
   - Summarizes tickets for quick review

3. **Sentiment Agent** (`src/ai/agents/sentiment/index.ts`)
   - Analyzes customer sentiment from ticket content

4. **Playground Agent** (`src/ai/agents/playground.ts`)
   - Interactive testing interface for AI responses

## How It Works

### Model Selection Logic

```typescript
const isCustom =
  modelName.toLowerCase() === 'custom' || process.env.AI_MODEL === 'custom';

if (isCustom) {
  // Use ChatOpenAI with custom base URL
  return new ChatOpenAI({
    configuration: { baseURL, apiKey },
    modelName: customModelName,
    temperature: 0.3,
  });
} else {
  // Use Google Gemini
  return new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey,
    temperature: 0.3,
  });
}
```

### Key Benefits

1. **Single Source of Truth**: All AI model creation goes through one factory
2. **Easy Switching**: Change `AI_MODEL` env var to switch providers
3. **Consistent Logging**: All model initialization is logged with `[AI Factory]` prefix
4. **Error Prevention**: Validates required configuration before creating clients
5. **Maintainability**: Update model creation logic in one place

## Usage Example

```typescript
import { AIModelFactory } from '../ai-model.factory';
import { ConfigService } from '@nestjs/config';

// In your agent function
const model = AIModelFactory.create(configService);

// Use with LangChain
const agent = createAgent({
  model,
  tools: [yourTools],
  systemPrompt: 'Your prompt here',
});
```

## Debugging

The factory logs key information:

```
[AI Factory] Detected Model: 'custom' (Is Custom? true)
[AI Factory] Initializing Custom Client: gemma3:4b @ https://aii.bsai.cloud/api/v1
```

## Environment Configuration Notes

### Custom LLM Base URL

- Should point to the API root (e.g., `/v1`)
- The OpenAI SDK automatically appends `/chat/completions`
- ❌ Wrong: `https://api.example.com/v1/chat`
- ✅ Correct: `https://api.example.com/v1`

### Model Name Detection

- Checks both `process.env.AI_MODEL` and `configService.get('ai.model')`
- Strips quotes and whitespace
- Case-insensitive comparison
- Avoids issues with inline comments in `.env` files

## Migration Path

If you need to add a new AI provider in the future:

1. Add new environment variables for the provider
2. Update `AIModelFactory.create()` to detect the new provider
3. Create a new private method like `createCustomClient()`
4. All existing agents will automatically support the new provider

## Testing

To test the custom LLM:

1. Set `AI_MODEL=custom` in `.env`
2. Configure `AI_CUSTOM_*` variables
3. Restart the backend server
4. Check logs for `[AI Factory] Initializing Custom Client`
5. Test any AI endpoint (draft response, summarize, etc.)

To switch back to Gemini:

1. Set `AI_MODEL=gemini-2.0-flash-exp` (or any Gemini model)
2. Restart the backend server
3. Check logs for `[AI Factory] Initializing Gemini Client`
