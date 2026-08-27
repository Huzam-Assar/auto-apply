import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(directory, '../../.env') });

function booleanValue(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function numberValue(value, fallback, { min, max } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

export const config = Object.freeze({
  port: numberValue(process.env.PORT, 5000, { min: 1, max: 65535 }),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  schedulerEnabled: booleanValue(process.env.AUTO_APPLY_SCHEDULER_ENABLED, false),
  intervalMinutes: numberValue(process.env.AUTO_APPLY_INTERVAL_MINUTES, 1, { min: 1, max: 59 }),
  geminiRetries: numberValue(process.env.GEMINI_RETRIES, 2, { min: 0, max: 4 }),
  geminiTimeoutMs: numberValue(process.env.GEMINI_TIMEOUT_MS, 20000, { min: 1000, max: 120000 }),
});
