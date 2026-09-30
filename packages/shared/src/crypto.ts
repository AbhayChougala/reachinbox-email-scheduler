import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function encryptSecret(value: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value: string, base64Key: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(base64Key, 'base64'), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
