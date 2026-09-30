import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { encryptSecret, getConfig, prisma } from '@reachinbox/shared';

export function beginSlack(req: Request, res: Response): void {
  const env = getConfig();
  const state = randomBytes(32).toString('base64url');
  req.session.slackOauth = { state, createdAt: Date.now() };
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
  if (!req.session.userId || !pending || pending.state !== state || Date.now() - pending.createdAt > 10 * 60_000) {
    res.status(400).send('Invalid or expired Slack OAuth state.'); return;
  }
  delete req.session.slackOauth;
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
      botTokenEnc: result.access_token ? encryptSecret(String(result.access_token), env.INTEGRATION_ENCRYPTION_KEY) : null,
      enabled: true
    },
    create: {
      ownerId: req.session.userId, teamId: String(result.team?.id ?? ''), teamName: String(result.team?.name ?? ''),
      channelId: String(result.incoming_webhook.channel_id ?? ''), channelName: String(result.incoming_webhook.channel ?? ''),
      webhookUrlEnc: encryptSecret(String(result.incoming_webhook.url), env.INTEGRATION_ENCRYPTION_KEY),
      botTokenEnc: result.access_token ? encryptSecret(String(result.access_token), env.INTEGRATION_ENCRYPTION_KEY) : null
    }
  });
  res.redirect(`${env.WEB_ORIGIN}?slack=connected`);
}
