import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  config: {
    SLACK_CLIENT_ID: 'client-id',
    SLACK_CLIENT_SECRET: 'client-secret',
    SLACK_REDIRECT_URI: 'https://mail.example.com/api/integrations/slack/callback',
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    WEB_ORIGIN: 'https://mail.example.com'
  },
  upsert: vi.fn()
}));

vi.mock('@reachinbox/shared', () => ({
  getConfig: () => shared.config,
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  prisma: { slackIntegration: { upsert: shared.upsert } }
}));

import { beginSlack, finishSlack } from '../../apps/api/src/slack.ts';

function response() {
  const res: any = {
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
    redirect: vi.fn()
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('Slack OAuth state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('requires an authenticated session before starting OAuth', async () => {
    const req: any = { session: {}, sessionID: 'unauthenticated-session' };
    const res = response();

    await beginSlack(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(req.session.slackOauth).toBeUndefined();
  });

  it('persists incoming-webhook state before redirecting and binds it to the signed-in user', async () => {
    const order: string[] = [];
    const req: any = {
      sessionID: 'authenticated-session',
      session: {
        userId: 'user-a',
        save: vi.fn((callback: (error?: Error) => void) => {
          order.push('save');
          callback();
        })
      },
      hostname: 'mail.example.com',
      protocol: 'https'
    };
    const res = response();
    res.redirect.mockImplementation(() => order.push('redirect'));

    await beginSlack(req, res);

    const authorizeUrl = new URL(res.redirect.mock.calls[0][0]);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(authorizeUrl.searchParams.get('scope')).toBe('incoming-webhook');
    expect(authorizeUrl.searchParams.get('user_scope')).toBeNull();
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(shared.config.SLACK_REDIRECT_URI);
    expect(req.session.slackOauth).toMatchObject({
      state: authorizeUrl.searchParams.get('state'),
      userId: 'user-a'
    });
    expect(req.session.slackOauth.state).toHaveLength(43);
    expect(Date.now() - req.session.slackOauth.createdAt).toBeLessThan(1_000);
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(order).toEqual(['save', 'redirect']);
  });

  it.each([
    ['a callback in another user session', { userId: 'user-b', slackOauth: { state: 'valid', userId: 'user-a', createdAt: Date.now() } }, 'Invalid Slack OAuth state. Connect again.'],
    ['an expired pending authorization', { userId: 'user-a', slackOauth: { state: 'valid', userId: 'user-a', createdAt: Date.now() - 10 * 60_000 - 1 } }, 'Slack OAuth state expired. Connect again.'],
    ['a state mismatch', { userId: 'user-a', slackOauth: { state: 'different', userId: 'user-a', createdAt: Date.now() } }, 'Invalid Slack OAuth state. Connect again.']
  ])('rejects %s before exchanging the OAuth code', async (_label, session, message) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req: any = {
      session,
      sessionID: 'callback-session',
      query: { state: 'valid', code: 'code' },
      get: vi.fn(() => 'session-cookie'),
      hostname: 'mail.example.com',
      protocol: 'https'
    };
    const res = response();

    await finishSlack(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shared.upsert).not.toHaveBeenCalled();
  });

  it('reports a missing session separately from an expired state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const req: any = {
      session: {}, sessionID: 'new-callback-session', query: { state: 'valid', code: 'code' },
      get: vi.fn(() => undefined), hostname: 'mail.example.com', protocol: 'https'
    };
    const res = response();

    await finishSlack(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('session is missing'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the OAuth-issued webhook for the current owner without retaining an unused token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        access_token: 'unused-token',
        team: { id: 'team-id', name: 'Test Workspace' },
        incoming_webhook: { url: 'https://hooks.slack.test/secret', channel_id: 'channel-id', channel: 'reachinbox-test' }
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    const req: any = {
      sessionID: 'callback-session',
      session: {
        userId: 'user-a',
        slackOauth: { state: 'valid', userId: 'user-a', createdAt: Date.now() },
        save: vi.fn((callback: (error?: Error) => void) => callback())
      },
      query: { state: 'valid', code: 'code' },
      get: vi.fn(() => 'session-cookie'),
      hostname: 'mail.example.com',
      protocol: 'https'
    };
    const res = response();

    await finishSlack(req, res);

    const exchangeBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(fetchMock.mock.calls[0][0]).toBe('https://slack.com/api/oauth.v2.access');
    expect(exchangeBody.get('redirect_uri')).toBe(shared.config.SLACK_REDIRECT_URI);
    expect(shared.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'user-a' },
      update: expect.objectContaining({
        teamName: 'Test Workspace',
        channelName: 'reachinbox-test',
        webhookUrlEnc: 'encrypted:https://hooks.slack.test/secret',
        botTokenEnc: null,
        enabled: true
      })
    }));
    expect(req.session.slackOauth).toBeUndefined();
    expect(req.session.save).toHaveBeenCalledOnce();
    expect(res.redirect).toHaveBeenCalledWith('https://mail.example.com?slack=connected');
  });
});
