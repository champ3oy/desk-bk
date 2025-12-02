import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  model: process.env.AI_MODEL || 'gemini-2.0-flash-exp',
}));

