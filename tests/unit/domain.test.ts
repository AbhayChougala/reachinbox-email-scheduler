import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fingerprint, normalizeAndValidateRecipients, scheduleSchema } from '../../packages/shared/src/index.ts';
import { parseLeadText } from '../../apps/web/src/leads.ts';
import { buildEmailSearch } from '../../apps/api/src/search.ts';
import { classifySmtpError } from '../../apps/worker/src/processors.ts';

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

describe('tenant search isolation', () => {
  it('always installs an owner filter alongside status and text queries', () => {
    const request = buildEmailSearch({ ownerId: 'owner-a', tab: 'sent', q: 'Ada', page: 2, pageSize: 25 });
    expect(request.from).toBe(25);
    expect(request.query.bool.filter).toContainEqual({ term: { ownerId: 'owner-a' } });
    expect(request.query.bool.filter).toContainEqual({ terms: { status: ['SENT', 'FAILED', 'AMBIGUOUS'] } });
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
