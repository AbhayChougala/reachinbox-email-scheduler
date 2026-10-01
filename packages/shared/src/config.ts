import { z } from 'zod';

const placeholder = (value: string) => !value.startsWith('replace');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:4000'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ELASTICSEARCH_URL: z.string().url(),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails-v1'),
  SESSION_SECRET: z.string().min(32).refine(placeholder, 'must not be a placeholder'),
  INTEGRATION_ENCRYPTION_KEY: z.string().refine((value) => {
    try { return Buffer.from(value, 'base64').length === 32; } catch { return false; }
  }, 'must be exactly 32 bytes encoded as base64'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SLACK_CLIENT_ID: z.string().min(1)
    .refine((value) => value === value.trim(), 'must not contain surrounding whitespace')
    .refine(placeholder, 'must not be a placeholder')
    .regex(/^\d+\.\d+$/, 'must be a Slack Client ID, not an App ID or token'),
  SLACK_CLIENT_SECRET: z.string().min(1)
    .refine((value) => value === value.trim(), 'must not contain surrounding whitespace')
    .refine(placeholder, 'must not be a placeholder'),
  SLACK_REDIRECT_URI: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_POLL_MS: z.coerce.number().int().min(500).default(5000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  SMTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  DEFAULT_SENDER_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
  DEFAULT_SENDER_HOURLY_LIMIT: z.coerce.number().int().min(1).default(100),
  MAX_CAMPAIGN_RECIPIENTS: z.coerce.number().int().min(1).max(10000).default(5000),
  ADMIN_EMAILS: z.string().default('')
});

export type AppConfig = z.infer<typeof schema> & { adminEmails: Set<string> };

let cached: AppConfig | undefined;

export function resolveRuntimeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...source };
  const renderHostname = source.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHostname) {
    const renderOrigin = new URL(`https://${renderHostname}`).origin;
    resolved.WEB_ORIGIN ||= renderOrigin;
    resolved.PUBLIC_ORIGIN ||= renderOrigin;
    resolved.GOOGLE_REDIRECT_URI ||= new URL('/api/auth/google/callback', renderOrigin).href;
    resolved.SLACK_REDIRECT_URI ||= new URL('/api/integrations/slack/callback', renderOrigin).href;
  }
  const elasticsearchHostport = source.RENDER_ELASTICSEARCH_HOSTPORT?.trim();
  if (!resolved.ELASTICSEARCH_URL && elasticsearchHostport) {
    resolved.ELASTICSEARCH_URL = new URL(`http://${elasticsearchHostport}`).origin;
  }
  return resolved;
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(resolveRuntimeEnv(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  cached = {
    ...parsed.data,
    adminEmails: new Set(parsed.data.ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
  };
  return cached;
}

export function resetConfigForTests(): void { cached = undefined; }
