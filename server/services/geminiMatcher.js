import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';

const ALLOWED_DECISIONS = new Set(['AUTO_APPLY', 'RECOMMEND', 'REVIEW', 'REJECT']);
const GEMINI_MIN_REQUEST_INTERVAL_MS = 4_500;
const MAX_RATE_LIMIT_WAITS_PER_MATCH = 10;
const MAX_QUOTA_RESET_WAIT_MS = 24 * 60 * 60 * 1_000;
let nextGeminiRequestAt = 0;

export const SYSTEM_INSTRUCTION = `You are an AI teacher-tuition matching engine for a broad marketplace. Evaluate ONLY two things: (1) whether the teacher's stated skills explicitly support teaching the tuition subject; and (2) whether the teacher's stated grades support the requested class grade. Apply the same rule to every subject area. Do not require identical text, but require direct, teachable subject evidence in the stated skills: the requested subject itself, a specific topic within it, or a genuine parent/child curriculum relationship (for example, computer science can support Python programming). Do NOT infer a teaching qualification merely because a skill uses, includes, or is academically founded on another subject. Data Science alone is not evidence that the teacher can teach Mathematics; cloud/infrastructure tools alone are not evidence of web-development teaching. These are examples of the general no-indirect-foundation rule, not a subject allowlist. When the profile lacks direct subject evidence, return match=false and decision=REJECT rather than rewarding a plausible academic connection. Never claim a teacher is qualified based on unstated statistics, calculus, or other supporting knowledge. Return AUTO_APPLY only for clear direct curriculum evidence with no known grade mismatch; in that case return match=true and score 75 to 90. Return REVIEW or REJECT for ambiguous/adjacent skills. A known grade mismatch must reduce the result below auto-apply quality. If grades are not stated, list grade as unknown but do not reject a clear direct skill match solely for that absence. The backend has already checked mode, on-site location, and language. Do not consider education, degree/major, experience, availability, timing, price, city, country, gender, religion, age, date of birth, or any other information. Never invent skills or grades. Return ONLY a JSON object with exactly these fields: match (boolean), score (number 0-100), confidence (number 0-1), decision (AUTO_APPLY|RECOMMEND|REVIEW|REJECT), matchedRequirements (string array), missingRequirements (string array), concerns (string array), reason (string).`;

function parsedJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

export function validateGeminiMatch(candidate) {
  if (!candidate || typeof candidate !== 'object') return { valid: false, error: 'Response is not an object' };
  const arrays = ['matchedRequirements', 'missingRequirements', 'concerns'];
  if (typeof candidate.match !== 'boolean') return { valid: false, error: 'match must be boolean' };
  if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100) return { valid: false, error: 'score must be 0-100' };
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) return { valid: false, error: 'confidence must be 0-1' };
  if (!ALLOWED_DECISIONS.has(candidate.decision)) return { valid: false, error: 'Invalid decision' };
  if (arrays.some((key) => !Array.isArray(candidate[key]) || candidate[key].some((item) => typeof item !== 'string'))) {
    return { valid: false, error: 'Requirement fields must be string arrays' };
  }
  if (typeof candidate.reason !== 'string') return { valid: false, error: 'reason must be a string' };

  return {
    valid: true,
    value: {
      match: candidate.match,
      score: Math.round(candidate.score),
      confidence: Number(candidate.confidence.toFixed(3)),
      decision: candidate.decision,
      matchedRequirements: candidate.matchedRequirements,
      missingRequirements: candidate.missingRequirements,
      concerns: candidate.concerns,
      reason: candidate.reason.trim(),
    },
  };
}

function callWithTimeout(task, timeoutMs) {
  let timeout;
  return Promise.race([
    task,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Gemini request timed out')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isGeminiRateLimit(error) {
  return /\b429\b|resource_exhausted|quota exceeded|rate.limit/i.test(String(error?.message || error || ''));
}

export function geminiRateLimitDelayMs(error) {
  const message = String(error?.message || error || '');
  const retrySeconds = message.match(/retryDelay[^0-9]*([\d.]+)s/i)
    || message.match(/retry in\s+([\d.]+)s/i);
  const requestedMilliseconds = retrySeconds ? Math.ceil(Number(retrySeconds[1]) * 1_000) : 60_000;
  // Honor Gemini's supplied reset time (including longer quota windows) plus a small buffer.
  return Math.min(MAX_QUOTA_RESET_WAIT_MS, Math.max(1_000, requestedMilliseconds + 1_000));
}

async function claimGeminiRequestSlot() {
  while (true) {
    const remaining = nextGeminiRequestAt - Date.now();
    if (remaining <= 0) {
      nextGeminiRequestAt = Date.now() + GEMINI_MIN_REQUEST_INTERVAL_MS;
      return;
    }
    await wait(remaining);
  }
}

function deferGeminiRequests(milliseconds) {
  nextGeminiRequestAt = Math.max(nextGeminiRequestAt, Date.now() + milliseconds);
}

export function buildGeminiPayload(teacher, tuition) {
  return {
    teacher: {
      skills: teacher.skills,
      grades: teacher.grades,
    },
    tuition: {
      subject: tuition.subject || 'unknown',
      classGrade: tuition.classGrade || 'unknown',
    },
  };
}

export async function matchWithGemini(teacher, tuition) {
  if (!config.geminiApiKey) {
    return { ok: false, errorCode: 'AI_FAILED', error: 'GEMINI_API_KEY is not configured' };
  }

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const payload = buildGeminiPayload(teacher, tuition);

  let lastError = 'Unknown Gemini failure';
  let attempts = 0;
  let rateLimitWaits = 0;
  while (attempts <= config.geminiRetries) {
    await claimGeminiRequestSlot();
    try {
      const response = await callWithTimeout(ai.models.generateContent({
        model: config.geminiModel,
        contents: `${SYSTEM_INSTRUCTION}\n\nEvaluate this data:\n${JSON.stringify(payload)}`,
        config: { responseMimeType: 'application/json' },
      }), config.geminiTimeoutMs);
      const validation = validateGeminiMatch(parsedJson(response.text));
      if (validation.valid) return { ok: true, result: validation.value };
      lastError = validation.error;
      attempts += 1;
    } catch (error) {
      lastError = error.message || 'Gemini request failed';
      if (isGeminiRateLimit(error) && rateLimitWaits < MAX_RATE_LIMIT_WAITS_PER_MATCH) {
        const delay = geminiRateLimitDelayMs(error);
        rateLimitWaits += 1;
        deferGeminiRequests(delay);
        console.warn(`[GEMINI] Rate limit reached. Waiting ${Math.ceil(delay / 1000)} second(s), then retrying the same match.`);
        continue;
      }
      attempts += 1;
    }
  }

  console.warn(`[GEMINI] Match failed after retries: ${lastError}`);
  return { ok: false, errorCode: 'AI_FAILED', error: lastError };
}
