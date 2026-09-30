import type { NextFunction, Request, Response } from 'express';
import * as oidc from 'openid-client';
import { getConfig, prisma } from '@reachinbox/shared';
import { logger } from './logger.js';
import { saveSession, sessionFingerprint } from './session.js';

let oidcConfig: oidc.Configuration | undefined;

async function config(): Promise<oidc.Configuration> {
  if (!oidcConfig) {
    const env = getConfig();
    oidcConfig = await oidc.discovery(
      new URL('https://accounts.google.com'),
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET
    );
  }
  return oidcConfig;
}

export async function beginGoogle(req: Request, res: Response): Promise<void> {
  const env = getConfig();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  req.session.oauth = { state, nonce, codeVerifier, createdAt: Date.now() };
  await saveSession(req);
  logger.info({
    authFlow: 'google', phase: 'start', sessionIdHash: sessionFingerprint(req),
    hostname: req.hostname, protocol: req.protocol, stateSaved: true
  }, 'OAuth session prepared');
  const url = oidc.buildAuthorizationUrl(await config(), {
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: 'select_account'
  });
  res.redirect(url.href);
}

export async function finishGoogle(req: Request, res: Response): Promise<void> {
  const env = getConfig();
  const pending = req.session.oauth;
  const ageMs = pending ? Date.now() - Number(pending.createdAt) : null;
  logger.info({
    authFlow: 'google', phase: 'callback', sessionIdHash: sessionFingerprint(req),
    hostname: req.hostname, protocol: req.protocol, cookiePresent: Boolean(req.get('cookie')),
    pendingPresent: Boolean(pending), ageMs,
    returnedStatePresent: typeof req.query.state === 'string',
    stateMatches: Boolean(pending && req.query.state === pending.state)
  }, 'OAuth callback session check');
  if (!pending) {
    res.status(400).send('Google OAuth session is missing. Start sign-in again from the same HTTPS application URL.');
    return;
  }
  if (!Number.isFinite(ageMs) || ageMs! < 0 || ageMs! > 10 * 60_000) {
    res.status(400).send('OAuth state expired. Start sign-in again.');
    return;
  }
  if (typeof req.query.state !== 'string' || req.query.state !== pending.state) {
    res.status(400).send('Invalid Google OAuth state. Start sign-in again.');
    return;
  }
  const currentUrl = new URL(req.originalUrl, env.PUBLIC_ORIGIN);
  const tokens = await oidc.authorizationCodeGrant(await config(), currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true
  });
  const claims = tokens.claims();
  if (!claims?.sub || !claims.email || claims.email_verified !== true) {
    res.status(403).send('A verified Google email is required.');
    return;
  }
  const user = await prisma.user.upsert({
    where: { email: String(claims.email).toLowerCase() },
    update: {
      googleSubject: claims.sub,
      name: String(claims.name ?? claims.email),
      avatarUrl: claims.picture ? String(claims.picture) : null
    },
    create: {
      googleSubject: claims.sub,
      email: String(claims.email).toLowerCase(),
      name: String(claims.name ?? claims.email),
      avatarUrl: claims.picture ? String(claims.picture) : null
    }
  });
  await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  await saveSession(req);
  res.redirect(env.WEB_ORIGIN);
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) { res.status(401).json({ error: 'Authentication required' }); return; }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) { res.status(401).send('Authentication required'); return; }
  const user = await prisma.user.findUnique({ where: { id: req.session.userId }, select: { email: true } });
  if (!user || !getConfig().adminEmails.has(user.email.toLowerCase())) {
    res.status(403).send('Queue dashboard access requires ADMIN_EMAILS authorization.');
    return;
  }
  next();
}
