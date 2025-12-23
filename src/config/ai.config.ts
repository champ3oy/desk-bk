import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  model: process.env.AI_MODEL || 'custom',
  customBaseUrl: process.env.AI_CUSTOM_BASE_URL,
  customApiKey: process.env.AI_CUSTOM_API_KEY,
  customModelName: process.env.AI_CUSTOM_MODEL_NAME || 'llama3.1',
}));
