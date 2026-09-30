import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { encryptSecret, getConfig, prisma } from '@reachinbox/shared';
import { logger } from './logger.js';
import { saveSession, sessionFingerprint } from './session.js';

export async function beginSlack(req: Request, res: Response): Promise<void> {
  const env = getConfig();
  if (!req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const state = randomBytes(32).toString('base64url');
  req.session.slackOauth = { state, userId: req.session.userId, createdAt: Date.now() };
  await saveSession(req);
  logger.info({
    authFlow: 'slack', phase: 'start', sessionIdHash: sessionFingerprint(req),
    hostname: req.hostname, protocol: req.protocol, stateSaved: true
  }, 'OAuth session prepared');
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', 'incoming-webhook');
  url.searchParams.set('redirect_uri', env.SLACK_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.href);
}

export async function finishSlack(req: Request, res: Response): Promise<void> {
  const env = getConfig();
  const pending = req.session.slackOauth;
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const ageMs = pending ? Date.now() - Number(pending.createdAt) : null;
  logger.info({
    authFlow: 'slack', phase: 'callback', sessionIdHash: sessionFingerprint(req),
    hostname: req.hostname, protocol: req.protocol, cookiePresent: Boolean(req.get('cookie')),
    userPresent: Boolean(req.session.userId), pendingPresent: Boolean(pending), ageMs,
    returnedStatePresent: Boolean(state),
    stateMatches: Boolean(pending && pending.state === state),
    ownerMatches: Boolean(pending && pending.userId === req.session.userId)
  }, 'OAuth callback session check');
  if (!req.session.userId || !pending) {
    res.status(400).send('Slack OAuth session is missing. Sign in and connect again from the same HTTPS application URL.'); return;
  }
  if (!Number.isFinite(ageMs) || ageMs! < 0 || ageMs! > 10 * 60_000) {
    res.status(400).send('Slack OAuth state expired. Connect again.'); return;
  }
  if (pending.userId !== req.session.userId || pending.state !== state) {
    res.status(400).send('Invalid Slack OAuth state. Connect again.'); return;
  }
  delete req.session.slackOauth;
  await saveSession(req);
  const body = new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, client_secret: env.SLACK_CLIENT_SECRET, code, redirect_uri: env.SLACK_REDIRECT_URI });
  const response = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json() as any;
  if (!result.ok || !result.incoming_webhook?.url) { res.status(400).send(`Slack OAuth failed: ${String(result.error ?? 'unknown_error')}`); return; }
  await prisma.slackIntegration.upsert({
    where: { ownerId: req.session.userId },
    update: {
      teamId: String(result.team?.id ?? ''), teamName: String(result.team?.name ?? ''),
      channelId: String(result.incoming_webhook.channel_id ?? ''), channelName: String(result.incoming_webhook.channel ?? ''),
      webhookUrlEnc: encryptSecret(String(result.incoming_webhook.url), env.INTEGRATION_ENCRYPTION_KEY),
      botTokenEnc: null,
      enabled: true
    },
    create: {
      ownerId: req.session.userId, teamId: String(result.team?.id ?? ''), teamName: String(result.team?.name ?? ''),
      channelId: String(result.incoming_webhook.channel_id ?? ''), channelName: String(result.incoming_webhook.channel ?? ''),
      webhookUrlEnc: encryptSecret(String(result.incoming_webhook.url), env.INTEGRATION_ENCRYPTION_KEY),
      botTokenEnc: null
    }
  });
  res.redirect(`${env.WEB_ORIGIN}?slack=connected`);
}
