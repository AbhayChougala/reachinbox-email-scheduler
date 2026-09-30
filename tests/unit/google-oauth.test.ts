import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAuthorizationUrl: vi.fn(),
  calculatePKCECodeChallenge: vi.fn(),
  discovery: vi.fn(),
  loggerInfo: vi.fn()
}));

vi.mock('openid-client', () => ({
  randomState: () => 'google-state',
  randomNonce: () => 'google-nonce',
  randomPKCECodeVerifier: () => 'google-verifier',
  calculatePKCECodeChallenge: mocks.calculatePKCECodeChallenge,
  discovery: mocks.discovery,
  buildAuthorizationUrl: mocks.buildAuthorizationUrl
}));

vi.mock('@reachinbox/shared', () => ({
  getConfig: () => ({
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_REDIRECT_URI: 'https://mail.example.com/api/auth/google/callback',
    PUBLIC_ORIGIN: 'https://mail.example.com',
    WEB_ORIGIN: 'https://mail.example.com'
  }),
  prisma: { user: { upsert: vi.fn(), findUnique: vi.fn() } }
}));

vi.mock('../../apps/api/src/logger.js', () => ({
  logger: { info: mocks.loggerInfo }
}));

import { beginGoogle, finishGoogle } from '../../apps/api/src/auth.ts';

describe('Google OAuth state persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculatePKCECodeChallenge.mockResolvedValue('google-challenge');
    mocks.discovery.mockResolvedValue({});
    mocks.buildAuthorizationUrl.mockReturnValue(new URL('https://accounts.google.test/o/oauth2/auth'));
  });

  it('persists state, nonce, and PKCE verifier before redirecting', async () => {
    const order: string[] = [];
    const req: any = {
      sessionID: 'google-session',
      session: {
        save: vi.fn((callback: (error?: Error) => void) => {
          order.push('save');
          callback();
        })
      },
      hostname: 'mail.example.com',
      protocol: 'https'
    };
    const res: any = { redirect: vi.fn(() => order.push('redirect')) };

    await beginGoogle(req, res);

    expect(req.session.oauth).toMatchObject({
      state: 'google-state',
      nonce: 'google-nonce',
      codeVerifier: 'google-verifier'
    });
    expect(req.session.oauth.createdAt).toEqual(expect.any(Number));
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(order).toEqual(['save', 'redirect']);
  });

  it('does not redirect when session persistence fails', async () => {
    const req: any = {
      sessionID: 'google-session',
      session: { save: vi.fn((callback: (error?: Error) => void) => callback(new Error('store unavailable'))) },
      hostname: 'mail.example.com',
      protocol: 'https'
    };
    const res: any = { redirect: vi.fn() };

    await expect(beginGoogle(req, res)).rejects.toThrow('store unavailable');
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('distinguishes a missing OAuth session from a genuinely expired state', async () => {
    const response = () => {
      const res: any = { status: vi.fn(), send: vi.fn() };
      res.status.mockReturnValue(res);
      return res;
    };
    const baseRequest = {
      sessionID: 'google-callback-session',
      query: { state: 'google-state' },
      get: vi.fn(() => undefined),
      hostname: 'mail.example.com',
      protocol: 'https',
      originalUrl: '/api/auth/google/callback'
    };
    const missingRes = response();
    const expiredRes = response();

    await finishGoogle({ ...baseRequest, session: {} } as any, missingRes);
    await finishGoogle({
      ...baseRequest,
      session: {
        oauth: {
          state: 'google-state', nonce: 'google-nonce', codeVerifier: 'google-verifier',
          createdAt: Date.now() - 10 * 60_000 - 1
        }
      }
    } as any, expiredRes);

    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.send).toHaveBeenCalledWith(expect.stringContaining('session is missing'));
    expect(expiredRes.status).toHaveBeenCalledWith(400);
    expect(expiredRes.send).toHaveBeenCalledWith('OAuth state expired. Start sign-in again.');
  });
});
