import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  assertConfiguredDatabaseForMode,
  type AppMode,
} from './databaseSafety';
import {
  DEFAULT_DEMO_EXPIRY_SWEEP_MINUTES,
  DEFAULT_DEMO_SESSION_TTL_MINUTES,
} from '../features/demoSessionPolicy';

const envFile = process.env.ADVISORTRACK_ENV_FILE
  ? path.resolve(process.env.ADVISORTRACK_ENV_FILE)
  : path.resolve(process.cwd(), '.env');

if (process.env.ADVISORTRACK_ENV_FILE && !fs.existsSync(envFile)) {
  console.error(`ADVISORTRACK_ENV_FILE does not exist: ${envFile}`);
  process.exit(1);
}

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: Boolean(process.env.ADVISORTRACK_ENV_FILE) });
} else {
  dotenv.config();
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ADVISORTRACK_MODE: z.enum(['live', 'demo']).default('live'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  DEMO_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(DEFAULT_DEMO_SESSION_TTL_MINUTES),
  DEMO_EXPIRY_SWEEP_MINUTES: z.coerce.number().int().positive().default(DEFAULT_DEMO_EXPIRY_SWEEP_MINUTES),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:5174,http://localhost:8081,http://localhost:19006,http://127.0.0.1:5173,http://127.0.0.1:5174'
    ),
  DATABASE_URL: z.string().optional(),
  /** Base64-encoded 32-byte key for AES-256-GCM encryption of contact PII (POPIA). */
  PII_ENCRYPTION_KEY: z.string().optional(),
  /** Version string shown in the app POPIA notice — stored on consent records. */
  POPIA_NOTICE_VERSION: z.string().default('2026-06'),
  /** Mailtrap Email Sending API token (transactional email). */
  MAILTRAP_API_TOKEN: z.string().optional(),
  MAIL_FROM_EMAIL: z.string().email().default('hello@advisortrack.co.za'),
  MAIL_FROM_NAME: z.string().default('AdvisorTrack'),
  /** Deep link scheme used in verification / reset emails (matches app.json scheme). */
  APP_DEEP_LINK_SCHEME: z.string().default('advisortrack'),
  /** AdvisorTrack Assistant runtime model. Default disabled. `xai` uses Grok 4.6. */
  ASSISTANT_MODEL_PROVIDER: z.enum(['disabled', 'http', 'xai']).default('disabled'),
  ASSISTANT_MODEL_URL: z.string().optional(),
  ASSISTANT_MODEL_API_KEY: z.string().optional(),
  ASSISTANT_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  XAI_API_KEY: z.string().optional(),
  /** Chat Completions base URL. Default global; set US regional later without a code change. */
  ASSISTANT_MODEL_BASE_URL: z.string().optional(),
  ASSISTANT_MODEL_NAME: z.string().optional(),
  ASSISTANT_MODEL_REASONING: z.enum(['low', 'medium', 'high', 'xhigh']).default('medium'),
  ASSISTANT_MODEL_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(4096).default(1536),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;
const appMode: AppMode = data.ADVISORTRACK_MODE;

let configuredDatabase;
try {
  configuredDatabase = assertConfiguredDatabaseForMode(appMode, data.DATABASE_URL);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (appMode === 'demo' && data.MAILTRAP_API_TOKEN) {
  console.warn(
    '[demo] MAILTRAP_API_TOKEN is set but will not be used. Remove it from the demo environment.'
  );
}

/**
 * Validated application configuration loaded from environment variables.
 */
export const env = {
  port: data.PORT,
  nodeEnv: data.NODE_ENV,
  appMode,
  isDemoMode: appMode === 'demo',
  jwtSecret: data.JWT_SECRET,
  jwtExpiresIn: data.JWT_EXPIRES_IN,
  demoSessionTtlMinutes: data.DEMO_SESSION_TTL_MINUTES,
  demoExpirySweepMinutes: data.DEMO_EXPIRY_SWEEP_MINUTES,
  corsOrigins: data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  databaseUrl: data.DATABASE_URL,
  configuredDatabase,
  piiEncryptionKey: data.PII_ENCRYPTION_KEY,
  popiaNoticeVersion: data.POPIA_NOTICE_VERSION,
  mailtrapApiToken: appMode === 'demo' ? undefined : data.MAILTRAP_API_TOKEN,
  mailFromEmail: data.MAIL_FROM_EMAIL,
  mailFromName: data.MAIL_FROM_NAME,
  appDeepLinkScheme: data.APP_DEEP_LINK_SCHEME,
  assistantModelProvider: data.ASSISTANT_MODEL_PROVIDER,
  assistantModelUrl: data.ASSISTANT_MODEL_URL?.trim() || '',
  assistantModelApiKey: data.ASSISTANT_MODEL_API_KEY?.trim() || '',
  assistantModelTimeoutMs: data.ASSISTANT_MODEL_TIMEOUT_MS,
  xaiApiKey: data.XAI_API_KEY?.trim() || data.ASSISTANT_MODEL_API_KEY?.trim() || '',
  assistantModelBaseUrl: data.ASSISTANT_MODEL_BASE_URL?.trim() || 'https://api.x.ai/v1',
  assistantModelName: data.ASSISTANT_MODEL_NAME?.trim() || 'grok-4.6',
  assistantModelReasoning: data.ASSISTANT_MODEL_REASONING,
  assistantModelMaxOutputTokens: data.ASSISTANT_MODEL_MAX_OUTPUT_TOKENS,
  isDev: data.NODE_ENV === 'development',
};
