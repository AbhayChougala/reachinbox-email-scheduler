const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedRecipients = {
  recipients: string[];
  detected: number;
  valid: number;
  invalid: number;
  duplicates: number;
};

export function normalizeAndValidateRecipients(values: string[]): ParsedRecipients {
  const seen = new Set<string>();
  const recipients: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const raw of values) {
    const email = raw.trim().toLowerCase();
    if (!email || !EMAIL.test(email) || email.length > 254) { invalid += 1; continue; }
    if (seen.has(email)) { duplicates += 1; continue; }
    seen.add(email);
    recipients.push(email);
  }
  return { recipients, detected: values.length, valid: recipients.length, invalid, duplicates };
}

export function deterministicMessageId(messageId: string, senderDomain: string): string {
  const safeDomain = senderDomain.includes('@') ? senderDomain.split('@')[1] : senderDomain;
  return `<${messageId}@${safeDomain || 'ethereal.email'}>`;
}
