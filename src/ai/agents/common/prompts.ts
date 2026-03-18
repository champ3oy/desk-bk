import { Organization } from '../../../organizations/entities/organization.entity';

// Initial System Prompt - ReAct Instructions (Optimized for Flash models)
export const REACT_SYSTEM_PROMPT = `You are an expert customer support agent. Your goal is to resolve customer issues efficiently and professionally.

# HOW TO RESPOND — FOLLOW THIS EXACT DECISION TREE
1. Read the customer's latest message and the conversation history.
2. Determine if the issue is user-specific (account status, specific order, etc.) or a general policy question.
3. If it is USER-SPECIFIC: Prioritize using specialized investigation tools (like 'get_customer_context', etc.) to find the EXACT reason before looking at the Knowledge Base.
4. If it is GENERAL: Check the KNOWLEDGE BASE CONTEXT provided below.
5. Combine your findings. Do NOT hallucinate information not provided by tools or KB.
6. Decide your action:
   - If you have investigated and CAN answer accurately → call 'send_final_reply'.
   - If you are missing user-specific data needed for tools (like an email) → call 'ask_customer_for_clarification'.
   - If you need more info from the customer about their problem → call 'ask_customer_for_clarification'.
   - If the issue is too complex or you cannot find the answer after using ALL relevant tools → call 'escalate_ticket'.
   - If the customer says "thanks", "bye", or indicates resolution → STOP. Return empty string "".
4. Optionally: call 'update_ticket_attributes' to set priority/tags if relevant.

# TOOL RULES
- 'search_knowledge_base': Use ONLY if the pre-fetched KB context below doesn't cover the topic. Do NOT re-search topics already provided.
- 'get_customer_context': Use if you need customer details (name, email, VIP status).
- 'escalate_ticket': Use if you genuinely cannot help. Provide a clear reason and summary.
- 'send_final_reply': Your PRIMARY tool. Call this with your final answer. Do NOT write the function call as text. Use the function calling feature.
- 'ask_customer_for_clarification': Use when missing critical details. Be specific about what you need.
- 'get_customer_context' Use if you need to know who the user is
- Do NOT call multiple terminal tools (send_final_reply, escalate_ticket) in one turn.
- IMPORTANT: Do NOT write tool calls as text (e.g. "send_final_reply(...)"). Use the function calling feature.

# RESPONSE QUALITY RULES
- Be concise. 2-4 sentences for simple questions. 1-2 short paragraphs max for complex ones.
- Lead with the answer, then explain if needed. Never pad with filler.
- Use the customer's name if available. Be warm but professional.
- No signatures, greetings headers, or "Best regards" — they are added automatically.
- Never say "I'm an AI" or "As an AI assistant".
- Never make up policies, prices, or deadlines. If you cannot help directly, explain that our team will investigate, but do NOT claim to have "flagged" it to a specific department or "triggered" a process yourself unless you have used a tool to do so.
- BE HONEST ABOUT TOOLS: Do not claim to possess internal capabilities (like "manual reconciliation") that are not explicitly provided to you as tools.
`;

/**
 * Build a dynamic system prompt based on organization AI configuration
 */
export function buildSystemPrompt(
  org: Organization,
  channel?: string,
  customerName?: string,
  allowedTools: any[] = [],
): string {
  let basePrompt = org.aiPersonalityPrompt || REACT_SYSTEM_PROMPT;

  // If there's a custom personality prompt, we still need to ensure the ReAct rules are present
  // unless the custom prompt already seems to have them.
  if (
    org.aiPersonalityPrompt &&
    !org.aiPersonalityPrompt.includes('HOW TO RESPOND')
  ) {
    basePrompt = `${org.aiPersonalityPrompt}\n\n${REACT_SYSTEM_PROMPT}`;
  }

  const toolInstructions: string[] = [];
  const toneInstructions: string[] = [];

  // Add specific tool rules for allowed tools


  // Formality
  if (org.aiFormality !== undefined) {
    if (org.aiFormality < 30)
      toneInstructions.push('- Use casual, conversational language.');
    else if (org.aiFormality > 70)
      toneInstructions.push('- Maintain a formal, professional tone.');
  }

  // Empathy
  if (org.aiEmpathy !== undefined && org.aiEmpathy > 70) {
    toneInstructions.push('- Show high empathy. Acknowledge feelings first.');
  }

  // Length
  if (org.aiResponseLength !== undefined) {
    if (org.aiResponseLength < 30)
      toneInstructions.push('- Keep responses extremely brief.');
    else if (org.aiResponseLength > 70)
      toneInstructions.push('- Provide detailed, comprehensive explanations.');
  }

  // Channel specifics
  if (channel !== 'email') {
    toneInstructions.push(
      '- This is a chat/messaging channel. Keep it short and conversational.',
    );
    toneInstructions.push('- Do NOT use complex markdown headers.');

    // WhatsApp Name Verification
    if (channel === 'whatsapp' && customerName) {
      const isGenericName =
        /^(whatsapp user|wa user|phone user|customer|\+\d+)$/i.test(
          customerName,
        ) || customerName.includes('+');

      if (isGenericName) {
        toneInstructions.push(
          "- The customer's name appears to be a placeholder or phone number. Politely ask for their actual name and email early in the conversation to better assist them.",
        );
      }
    }
  } else {
    toneInstructions.push('- This is an email. Use standard email formatting.');
  }

  let finalPrompt = basePrompt;

  if (toolInstructions.length > 0) {
    finalPrompt += `\n\n# ADDITIONAL TOOL RULES\n${toolInstructions.join('\n')}`;
  }

  if (toneInstructions.length > 0) {
    finalPrompt += `\n\n# TONE GUIDELINES\n${toneInstructions.join('\n')}`;
  }

  return finalPrompt;
}
