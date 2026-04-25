/**
 * OpenAI API client for the configured reasoning model.
 * Used for upstream analysis and verification.
 *
 * Uses the Responses API for reasoning control support.
 * The `effort` parameter maps to `reasoning.effort` on the request,
 * giving the model explicit guidance on how much thinking to invest.
 */

import OpenAI from 'openai';
import { ApiError, ParseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ApiError('api', 'openai', 'OPENAI_API_KEY is not set in environment');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export interface GptCallParams {
  systemPrompt: string;
  userMessage: string;
  stage: string;
  /** Reasoning effort level — maps to reasoning.effort on the Responses API. */
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

export interface GptCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Whether the response used cached input tokens (provider-side). */
  cachedInputTokens: number;
}

const RETRY_DELAY_MS = 5000;
/** Primary GPT model used for upstream analysis and verification. */
export const GPT_MODEL = 'o3' as const;
const MODEL = GPT_MODEL;

/**
 * Call the configured OpenAI reasoning model via the Responses API.
 *
 * The Responses API supports:
 * - reasoning.effort: controls how much thinking the model invests
 * - Automatic input caching for repeated prefixes (provider-managed)
 * - Structured input via system/user content blocks
 */
/**
 * Build the Responses API request body for testability.
 * Exported so tests can verify the exact request shape
 * without making real API calls.
 */
export function buildGptRequestBody(params: GptCallParams) {
  const { systemPrompt, userMessage, effort = 'high', maxTokens = 32000 } = params;
  return {
    model: MODEL,
    max_output_tokens: maxTokens,
    reasoning: { effort },
    instructions: systemPrompt,
    input: userMessage,
  };
}

export async function callGpt(params: GptCallParams): Promise<GptCallResult> {
  const { stage, effort = 'high' } = params;

  logger.info(stage, `Calling OpenAI reasoning model ${MODEL} (effort: ${effort})...`);

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const requestBody = buildGptRequestBody(params);
      const response = await getClient().responses.create(requestBody);

      // Extract text output from response — handle both message and text output items
      let content: string | undefined;
      for (const item of response.output) {
        if ((item as any).type === 'message') {
          const msgContent = (item as any).content;
          if (Array.isArray(msgContent)) {
            const textPart = msgContent.find((c: any) => c.type === 'output_text');
            if (textPart?.text) { content = textPart.text; break; }
          }
        }
        // Direct text output
        if ((item as any).type === 'output_text' && (item as any).text) {
          content = (item as any).text;
          break;
        }
      }
      // Fallback: try output_text at top level
      if (!content) {
        content = (response as any).output_text;
      }

      if (!content) {
        throw new ParseError(stage, `Empty response from OpenAI model ${MODEL}`);
      }

      const usage = response.usage;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      const cachedInputTokens = (usage as any)?.input_tokens_details?.cached_tokens ?? 0;

      logger.info(stage, `OpenAI model ${MODEL} response received`, {
        tokens: inputTokens + outputTokens,
        effort,
        cached: cachedInputTokens,
      });

      return {
        content,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedInputTokens,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof ParseError) throw err;

      if (attempt === 0) {
        logger.warn(stage, `OpenAI model ${MODEL} call failed, retrying in ${RETRY_DELAY_MS}ms...`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  throw new ApiError(
    stage,
    'openai',
    `Failed after 2 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// ─── Multimodal Vision API ──────────────────────────────────────────────────

/** Vision model used for multimodal observation (reference images). */
export const GPT_VISION_MODEL = 'gpt-4o' as const;
const VISION_MODEL = GPT_VISION_MODEL;

export interface GptVisionCallParams {
  systemPrompt: string;
  userText: string;
  /** Base64-encoded image data (PNG or JPEG). */
  imageBase64: string;
  /** MIME type of the image. */
  mediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
  stage: string;
  maxTokens?: number;
}

/**
 * Call GPT-4o with image + text for structured visual observation.
 * Uses Chat Completions API (Vision is not on Responses API yet).
 */
export async function callGptVision(params: GptVisionCallParams): Promise<GptCallResult> {
  const {
    systemPrompt, userText, imageBase64, stage,
    mediaType = 'image/png', maxTokens = 4000,
  } = params;

  logger.info(stage, 'Calling GPT-4o Vision...');

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getClient().chat.completions.create({
        model: VISION_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mediaType};base64,${imageBase64}`,
                  detail: 'high',
                },
              },
              { type: 'text', text: userText },
            ],
          },
        ],
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new ParseError(stage, 'Empty response from GPT-4o Vision');
      }

      const usage = response.usage;
      logger.info(stage, 'GPT-4o Vision response received', {
        tokens: usage?.total_tokens ?? 0,
      });

      return {
        content: choice.message.content,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        cachedInputTokens: 0,
      };
    } catch (err) {
      lastError = err;
      if (err instanceof ParseError) throw err;
      if (attempt === 0) {
        logger.warn(stage, `GPT-4o Vision call failed, retrying in ${RETRY_DELAY_MS}ms...`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  throw new ApiError(
    stage, 'openai',
    `Vision failed after 2 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Extract JSON from a GPT response that may contain markdown code fences.
 */
export function extractJson<T>(content: string, stage: string): T {
  // Try direct parse first
  try {
    return JSON.parse(content) as T;
  } catch {
    // Try extracting from code fence
    const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]) as T;
      } catch (e) {
        throw new ParseError(stage, `JSON inside code fence is malformed: ${e instanceof Error ? e.message : String(e)}`, content);
      }
    }

    // Try finding JSON object/array boundaries
    const objStart = content.indexOf('{');
    const arrStart = content.indexOf('[');
    const start = objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
    if (start >= 0) {
      const sub = content.slice(start);
      try {
        return JSON.parse(sub) as T;
      } catch {
        // D4: Try balanced-brace extraction — find the matching closing brace
        if (content[start] === '{') {
          let depth = 0;
          let end = -1;
          for (let i = start; i < content.length; i++) {
            if (content[i] === '{') depth++;
            if (content[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end > start) {
            try {
              return JSON.parse(content.slice(start, end + 1)) as T;
            } catch { /* fall through */ }
          }
        }
      }
    }

    throw new ParseError(stage, 'No valid JSON found in response', content.slice(0, 500));
  }
}

/**
 * Extract JSON from a tagged wrapper first, then fall back to generic extraction.
 * Useful for stages where we can demand a strict tagged payload from the model.
 */
export function extractTaggedJson<T>(content: string, stage: string, tagName: string): T {
  const taggedMatch = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'));
  if (taggedMatch) {
    const body = taggedMatch[1].trim();
    try {
      return JSON.parse(body) as T;
    } catch (err) {
      throw new ParseError(
        stage,
        `Malformed JSON inside <${tagName}>: ${err instanceof Error ? err.message : String(err)}`,
        body.slice(0, 500),
      );
    }
  }

  return extractJson<T>(content, stage);
}
