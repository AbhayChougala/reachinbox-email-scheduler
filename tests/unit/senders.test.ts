import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTestAccount: vi.fn(),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
  findMany: vi.fn(),
  create: vi.fn(),
  lock: vi.fn()
}));

vi.mock('nodemailer', () => ({
  default: { createTestAccount: mocks.createTestAccount }
}));

vi.mock('@reachinbox/shared', () => ({
  encryptSecret: mocks.encryptSecret,
  getConfig: () => ({
    INTEGRATION_ENCRYPTION_KEY: 'test-key',
    DEFAULT_SENDER_MIN_INTERVAL_MS: 1000,
    DEFAULT_SENDER_HOURLY_LIMIT: 100
  }),
  prisma: {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.lock,
      sender: { findMany: mocks.findMany, create: mocks.create }
    }))
  }
}));

import { provisionEtherealSenders } from '../../apps/api/src/senders.ts';

const account = (suffix: string) => ({
  user: `${suffix}@ethereal.email`,
  pass: `password-${suffix}`,
  smtp: { host: 'smtp.ethereal.email', port: 587, secure: false }
});

describe('per-user sender provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lock.mockResolvedValue([{ id: 'owner-a' }]);
  });

  it('creates two distinct encrypted senders for a user without senders', async () => {
    mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'one', name: 'Outbound Primary' },
      { id: 'two', name: 'Outbound Secondary' }
    ]);
    mocks.createTestAccount.mockResolvedValueOnce(account('one')).mockResolvedValueOnce(account('two'));

    const result = await provisionEtherealSenders('owner-a');

    expect(mocks.createTestAccount).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ ownerId: 'owner-a', name: 'Outbound Primary', smtpUsernameEnc: 'encrypted:one@ethereal.email', smtpPasswordEnc: 'encrypted:password-one' })
    }));
    expect(mocks.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ ownerId: 'owner-a', name: 'Outbound Secondary', smtpUsernameEnc: 'encrypted:two@ethereal.email', smtpPasswordEnc: 'encrypted:password-two' })
    }));
    expect(result).toHaveLength(2);
  });

  it('returns existing senders without creating external accounts', async () => {
    const existing = [{ id: 'one', name: 'Outbound Primary' }, { id: 'two', name: 'Outbound Secondary' }];
    mocks.findMany.mockResolvedValue(existing);

    await expect(provisionEtherealSenders('owner-a')).resolves.toBe(existing);
    expect(mocks.createTestAccount).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
