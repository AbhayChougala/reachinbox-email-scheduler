import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fingerprint, normalizeAndValidateRecipients, resolveRuntimeEnv, scheduleSchema } from '../../packages/shared/src/index.ts';
import { parseLeadText } from '../../apps/web/src/leads.ts';
import { buildEmailSearch } from '../../apps/api/src/search.ts';
import { classifySmtpError } from '../../apps/worker/src/processors.ts';
import { canonicalPublicUrl } from '../../apps/web/src/origin.ts';
import { currentEmailResults, emailTimestampForTab, emailViewKey, formatSlackChannel } from '../../apps/web/src/display.ts';

describe('recipient ingestion', () => {
  it('parses common CSV headers and reports invalid/duplicate leads', () => {
    const result = parseLeadText('name,email\nAda,ADA@example.com\nBad,nope\nAda 2,ada@example.com');
    expect(result).toMatchObject({ detected: 3, valid: 1, invalid: 1, duplicates: 1 });
    expect(result.recipients).toEqual(['ada@example.com']);
  });

  it('normalizes text recipients without suppressing later campaigns', () => {
    const first = normalizeAndValidateRecipients(['One@Example.com', 'one@example.com']);
    const second = normalizeAndValidateRecipients(['one@example.com']);
    expect(first).toMatchObject({ valid: 1, duplicates: 1 });
    expect(second).toMatchObject({ valid: 1, duplicates: 0 });
  });
});

describe('security and request identity', () => {
  it('encrypts integration secrets with randomized authenticated ciphertext', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const a = encryptSecret('smtp-password', key);
    const b = encryptSecret('smtp-password', key);
    expect(a).not.toEqual(b);
    expect(decryptSecret(a, key)).toBe('smtp-password');
  });

  it('creates stable payload fingerprints independent of object key order', () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('requires an explicit offset-bearing UTC instant and timezone', () => {
    const base = { senderId: 's', subject: 'Hello', body: 'Body', recipients: ['a@example.com'], timezone: 'Asia/Kolkata', delaySeconds: 1, hourlyLimit: 2 };
    expect(scheduleSchema.safeParse({ ...base, startAtUtc: '2026-10-01T07:00:00.000Z' }).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...base, startAtUtc: '2026-10-01T12:30' }).success).toBe(false);
  });
});

describe('Render runtime configuration', () => {
  it('derives same-origin OAuth callbacks and the private Elasticsearch URL', () => {
    const resolved = resolveRuntimeEnv({
      RENDER_EXTERNAL_HOSTNAME: 'reachinbox-scheduler.onrender.com',
      RENDER_ELASTICSEARCH_HOSTPORT: 'reachinbox-elasticsearch:9200'
    });
    expect(resolved.WEB_ORIGIN).toBe('https://reachinbox-scheduler.onrender.com');
    expect(resolved.PUBLIC_ORIGIN).toBe('https://reachinbox-scheduler.onrender.com');
    expect(resolved.GOOGLE_REDIRECT_URI).toBe('https://reachinbox-scheduler.onrender.com/api/auth/google/callback');
    expect(resolved.SLACK_REDIRECT_URI).toBe('https://reachinbox-scheduler.onrender.com/api/integrations/slack/callback');
    expect(resolved.ELASTICSEARCH_URL).toBe('http://reachinbox-elasticsearch:9200');
  });

  it('preserves explicit non-Render configuration', () => {
    const resolved = resolveRuntimeEnv({
      RENDER_EXTERNAL_HOSTNAME: 'reachinbox-scheduler.onrender.com',
      WEB_ORIGIN: 'https://mail.example.com',
      PUBLIC_ORIGIN: 'https://mail.example.com',
      GOOGLE_REDIRECT_URI: 'https://mail.example.com/api/auth/google/callback',
      SLACK_REDIRECT_URI: 'https://mail.example.com/api/integrations/slack/callback',
      ELASTICSEARCH_URL: 'http://elasticsearch.example:9200',
      RENDER_ELASTICSEARCH_HOSTPORT: 'reachinbox-elasticsearch:9200'
    });
    expect(resolved).toMatchObject({
      WEB_ORIGIN: 'https://mail.example.com',
      PUBLIC_ORIGIN: 'https://mail.example.com',
      GOOGLE_REDIRECT_URI: 'https://mail.example.com/api/auth/google/callback',
      SLACK_REDIRECT_URI: 'https://mail.example.com/api/integrations/slack/callback',
      ELASTICSEARCH_URL: 'http://elasticsearch.example:9200'
    });
  });
});

describe('tenant search isolation', () => {
  it('always installs an owner filter alongside status and text queries', () => {
    const request = buildEmailSearch({ ownerId: 'owner-a', tab: 'sent', q: 'Ada', page: 2, pageSize: 25 });
    expect(request.from).toBe(25);
    expect(request.query.bool.filter).toContainEqual({ term: { ownerId: 'owner-a' } });
    expect(request.query.bool.filter).toContainEqual({ terms: { status: ['SENT', 'FAILED'] } });
    expect(buildEmailSearch({ ownerId: 'owner-a', tab: 'scheduled', q: 'Ada', page: 1, pageSize: 25 }).query.bool.filter)
      .toContainEqual({ terms: { status: ['SCHEDULED', 'QUEUED', 'SENDING'] } });
  });
});

describe('dashboard timestamps', () => {
  const item = { status: 'SENT', effectiveScheduledAt: '2026-10-01T10:00:00.000Z', sentAt: '2026-10-01T10:01:00.000Z' };

  it('uses effective time for scheduled rows and actual delivery time for sent rows', () => {
    expect(emailTimestampForTab('scheduled', item)).toBe(item.effectiveScheduledAt);
    expect(emailTimestampForTab('sent', item)).toBe(item.sentAt);
  });

  it('does not fabricate a sent time for failed rows or sent rows missing confirmation', () => {
    expect(emailTimestampForTab('sent', { ...item, status: 'FAILED', sentAt: null })).toBeNull();
    expect(emailTimestampForTab('sent', { ...item, sentAt: null })).toBeNull();
  });
});

describe('dashboard result identity', () => {
  it('does not expose a response from a previous tab, search, or page', () => {
    const scheduled = { key: emailViewKey('scheduled', 'rate-demo', 1), items: ['queued'] };
    expect(currentEmailResults(emailViewKey('sent', 'rate-demo', 1), scheduled)).toBeNull();
    expect(currentEmailResults(emailViewKey('scheduled', 'alex', 1), scheduled)).toBeNull();
    expect(currentEmailResults(emailViewKey('scheduled', 'rate-demo', 2), scheduled)).toBeNull();
    expect(currentEmailResults(emailViewKey('scheduled', 'rate-demo', 1), scheduled)).toBe(scheduled);
  });
});

describe('SMTP ambiguity policy', () => {
  it('retries only clearly retryable pre-acceptance failures', () => {
    expect(classifySmtpError({ responseCode: 451 })).toBe('retryable');
    expect(classifySmtpError({ code: 'ECONNREFUSED' })).toBe('retryable');
    expect(classifySmtpError({ responseCode: 550 })).toBe('permanent');
    expect(classifySmtpError({ code: 'ETIMEDOUT' })).toBe('ambiguous');
  });
});

describe('HTTPS development origin', () => {
  it('redirects loopback navigation to the canonical tunnel and leaves other hosts alone', () => {
    const origin = new URL('https://active-tunnel.trycloudflare.com');
    expect(canonicalPublicUrl('localhost:5173', '/api/auth/google', origin)).toBe('https://active-tunnel.trycloudflare.com/api/auth/google');
    expect(canonicalPublicUrl('127.0.0.1:5173', '/', origin)).toBe('https://active-tunnel.trycloudflare.com/');
    expect(canonicalPublicUrl('active-tunnel.trycloudflare.com', '/', origin)).toBeNull();
    expect(canonicalPublicUrl('untrusted.example', '/', origin)).toBeNull();
  });
});

describe('Slack destination display', () => {
  it('renders exactly one leading hash for provider channel names', () => {
    expect(formatSlackChannel('scheduler-alert')).toBe('#scheduler-alert');
    expect(formatSlackChannel('#scheduler-alert')).toBe('#scheduler-alert');
    expect(formatSlackChannel('##scheduler-alert')).toBe('#scheduler-alert');
  });
});
