import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  model: process.env.AI_MODEL || 'custom',
  customBaseUrl: process.env.AI_CUSTOM_BASE_URL,
  customApiKey: process.env.AI_CUSTOM_API_KEY,
  customModelName: process.env.AI_CUSTOM_MODEL_NAME || 'llama3.1',
  disablePolling:
    process.env.EMAIL_DISABLE_POLLING === 'true' ||
    (process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_POLLING !== 'true'),
  emailDisableScraping:
    process.env.EMAIL_DISABLE_SCRAPING === 'true' ||
    (process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_EMAIL_SCRAPING !== 'true'),
  webDisableScraping:
    process.env.WEB_DISABLE_SCRAPING === 'true' ||
    (process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_WEB_SCRAPING !== 'true'),
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsAgentId: process.env.ELEVENLABS_AGENT_ID,
}));
