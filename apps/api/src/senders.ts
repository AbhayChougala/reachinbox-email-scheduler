import { encryptSecret, getConfig, prisma } from '@reachinbox/shared';

const senderLabels = ['Outbound Primary', 'Outbound Secondary'] as const;

export type PublicSender = {
  id: string;
  name: string;
  email: string;
  minIntervalMs: number;
  hourlyLimit: number;
};

const publicSenderSelect = {
  id: true,
  name: true,
  email: true,
  minIntervalMs: true,
  hourlyLimit: true
} as const;

export async function provisionEtherealSenders(ownerId: string): Promise<PublicSender[]> {
  const env = getConfig();

  return prisma.$transaction(async (tx) => {
    // Serialize provisioning for this user. This keeps React retries and concurrent
    // requests from creating more than two external test accounts.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId} FOR UPDATE`;

    const existing = await tx.sender.findMany({
      where: { ownerId, enabled: true },
      orderBy: { createdAt: 'asc' },
      select: publicSenderSelect
    });
    if (existing.length >= senderLabels.length) return existing;

    // Nodemailer otherwise caches one Ethereal account per process. Disable that
    // before importing it so every missing sender receives distinct credentials.
    process.env.ETHEREAL_CACHE = 'no';
    const nodemailer = (await import('nodemailer')).default;
    const accounts = await Promise.all(
      senderLabels.slice(existing.length).map(() => nodemailer.createTestAccount())
    );

    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index]!;
      await tx.sender.create({
        data: {
          ownerId,
          name: senderLabels[existing.length + index]!,
          email: account.user,
          smtpHost: account.smtp.host,
          smtpPort: account.smtp.port,
          smtpSecure: account.smtp.secure,
          smtpUsernameEnc: encryptSecret(account.user, env.INTEGRATION_ENCRYPTION_KEY),
          smtpPasswordEnc: encryptSecret(account.pass, env.INTEGRATION_ENCRYPTION_KEY),
          minIntervalMs: env.DEFAULT_SENDER_MIN_INTERVAL_MS,
          hourlyLimit: env.DEFAULT_SENDER_HOURLY_LIMIT
        }
      });
    }

    return tx.sender.findMany({
      where: { ownerId, enabled: true },
      orderBy: { createdAt: 'asc' },
      select: publicSenderSelect
    });
  }, { maxWait: 10_000, timeout: 60_000 });
}
