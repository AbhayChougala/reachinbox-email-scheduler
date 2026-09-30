import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.url', 'req.raw.url', 'req.headers.cookie', 'req.headers.authorization',
      'req.query.state', 'req.query.code',
      'res.headers.location', 'res.headers["set-cookie"]',
      '*.password', '*.token', '*.webhook', '*.secret'
    ],
    censor: '[redacted]'
  }
});
