import { createHash } from 'node:crypto';
import type { Request } from 'express';

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

export function sessionFingerprint(req: Request): string {
  return createHash('sha256').update(req.sessionID).digest('hex').slice(0, 12);
}
