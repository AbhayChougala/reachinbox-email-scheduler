import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const input = process.env.DEV_HTTPS_ORIGIN ?? process.argv[2];
if (!input) throw new Error('Pass the public origin as DEV_HTTPS_ORIGIN or the first argument');

const origin = new URL(input);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('The public development origin must be an HTTPS origin with no path, query, or fragment');
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use. Stop the existing project dev process before starting another.`)
        : error);
    });
    server.listen({ port, host: '::' }, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

await assertPortAvailable(5173);
await assertPortAvailable(4000);

const childEnv: NodeJS.ProcessEnv = { ...process.env };
// For this launcher, Slack credentials deliberately come from the repository-root .env.
// This prevents a stale exported shell value from silently winning over that file.
delete childEnv.SLACK_CLIENT_ID;
delete childEnv.SLACK_CLIENT_SECRET;
Object.assign(childEnv, {
  ENV_FILE: path.join(projectRoot, '.env'),
  DEV_PUBLIC_HOST: origin.hostname,
  WEB_ORIGIN: origin.origin,
  PUBLIC_ORIGIN: origin.origin,
  GOOGLE_REDIRECT_URI: new URL('/api/auth/google/callback', origin).href,
  SLACK_REDIRECT_URI: new URL('/api/integrations/slack/callback', origin).href,
  TRUST_PROXY: 'true'
});

process.stdout.write(`HTTPS application origin: ${origin.origin}\n`);
process.stdout.write(`Google callback: ${childEnv.GOOGLE_REDIRECT_URI}\n`);
process.stdout.write(`Slack callback: ${childEnv.SLACK_REDIRECT_URI}\n`);

const child = spawn('npm', ['run', 'dev'], {
  cwd: projectRoot,
  env: childEnv,
  stdio: 'inherit'
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) => { throw error; });
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
