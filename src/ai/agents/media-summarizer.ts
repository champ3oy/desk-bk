import { AIModelFactory } from '../ai-model.factory';
import { ConfigService } from '@nestjs/config';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export const summarizeMedia = async (
  url: string,
  mimeType: string,
  configService: ConfigService,
): Promise<string> => {
  const model = AIModelFactory.create(configService, {
    provider: 'vertex',
    model: 'gemini-3-flash-preview',
  });

  try {
    const response = await fetch(url);
    if (!response.ok) return 'Failed to fetch media for summarization.';

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');

    const contentParts: any[] = [];

    if (mimeType.startsWith('image/')) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      });
    } else {
      contentParts.push({
        type: 'media',
        mimeType: mimeType,
        data: base64Data,
      });
    }

    contentParts.push({
      type: 'text',
      text: 'Provide a very concise (1-sentence) and objective description of this media content for context in a customer support conversation history.',
    });

    const aiResponse = await model.invoke([
      new SystemMessage(
        'You are a media analyst. Your goal is to describe images, audio, or video concisely for a support agent context.',
      ),
      new HumanMessage({ content: contentParts }),
    ]);

    const content =
      typeof aiResponse.content === 'string' ? aiResponse.content : '';
    return content.trim() || 'Media content description unavailable.';
  } catch (error) {
    console.error('[MediaSummarizer] Error summarizing media:', error);
    return 'Summary unavailable due to error.';
  }
};
