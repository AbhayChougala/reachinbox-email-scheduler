import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauth?: {
      state: string;
      nonce: string;
      codeVerifier: string;
      createdAt: number;
    };
    slackOauth?: { state: string; userId: string; createdAt: number };
  }
}
