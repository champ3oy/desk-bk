import { AIModelFactory } from '../ai-model.factory';
import { ConfigService } from '@nestjs/config';

export const generateInstructions = async (
  description: string,
  formality: number,
  empathy: number,
  verbosity: number,
  configService: ConfigService,
) => {
  const prompt = `
You are an expert AI personality designer. Your task is to generate detailed System Instructions for an AI agent based on the user's description and parameter settings.

USER DESCRIPTION: "${description}"

PARAMETERS:
- Formality: ${formality}/100 (0=Casual, 100=Formal)
- Empathy: ${empathy}/100 (0=Neutral, 100=Empathetic)
- Verbosity: ${verbosity}/100 (0=Concise, 100=Detailed)

OUTPUT FORMAT:
Generate a comprehensive System Prompt in Markdown format.
Structure it clearly with sections like # ROLE, # GUIDELINES, # TONE, # INSTRUCTIONS.
Do not include any preamble or extra text. Just the System Prompt.
The instructions should strictly reflect the provided parameters.
`;

  const model = AIModelFactory.create(configService);
  const response = await model.invoke(prompt);

  const content =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((item: any) =>
              typeof item === 'string' ? item : item.text || '',
            )
            .join('')
        : '';

  return {
    content,
  };
};
