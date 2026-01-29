import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as dotenv from 'dotenv';

dotenv.config();

const apiKey = process.argv[2] || process.env.ELEVENLABS_API_KEY;

if (!apiKey) {
  console.error('Usage: yarn ts-node scripts/create_agent.ts <API_KEY>');
  process.exit(1);
}

const client = new ElevenLabsClient({ apiKey });

async function main() {
  try {
    console.log('Authenticating with ElevenLabs...');
    const userInfo = await client.user.get();
    console.log(`Logged in as: ${userInfo.subscription.tier} user`);

    console.log('Creating new Agent...');

    // 1. Create the Agent
    // Using camelCase keys as per SDK requirements
    const agent = await client.conversationalAi.agents.create({
      name: 'Morpheus Support Agent',
      conversationConfig: {
        agent: {
          prompt: {
            prompt: `You are a helpful, witty, and friendly support agent for Morpheus Desk. 
You help users with their questions about the platform, tickets, and features.
You are concise but warm.`,
            llm: 'gpt-4-turbo',
            temperature: 0.7,
            knowledgeBase: [],
          },
          firstMessage:
            "Hello! I'm the Morpheus support agent. I'm here to help you with any questions you have.",
          language: 'en',
        },
        asr: {
          quality: 'high',
          provider: 'elevenlabs',
        },
        tts: {
          modelId: 'eleven_turbo_v2',
          agentOutputAudioFormat: 'pcm_44100',
        },
      } as any,
    });

    console.log('Agent created successfully!');
    console.log('---------------------------------------------------');

    // The response type might differ from runtime object, so we inspect it safely
    // Usually it is 'agent_id' or 'id'
    const agentData = agent as any;
    const agentId = agentData.agentId || agentData.agent_id || agentData.id;

    console.log(`AGENT ID: ${agentId}`);
    if (!agentId) {
      console.log(
        'Full Response for debugging:',
        JSON.stringify(agent, null, 2),
      );
    }
    console.log('---------------------------------------------------');

    console.log('To reference this agent, update your .env file:');
    console.log(`ELEVENLABS_API_KEY=${apiKey}`);
    console.log(`ELEVENLABS_AGENT_ID=${agentId}`);
  } catch (error: any) {
    console.error('Failed to create agent:', error.body || error.message);
    if (error.body) {
      console.error(JSON.stringify(error.body, null, 2));
    }
  }
}

main();
