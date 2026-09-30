import { encryptSecret, getConfig, prisma } from '../packages/shared/src/index.ts';

process.loadEnvFile?.('.env');
process.env.ETHEREAL_CACHE = 'no';
const nodemailer = (await import('nodemailer')).default;
const env = getConfig();
const ownerEmail = process.env.PROVISION_OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail) throw new Error('PROVISION_OWNER_EMAIL is required');

const owner = await prisma.user.upsert({
  where: { email: ownerEmail },
  update: { name: process.env.PROVISION_OWNER_NAME || 'ReachInbox Owner' },
  create: { email: ownerEmail, name: process.env.PROVISION_OWNER_NAME || 'ReachInbox Owner' }
});

const existing = await prisma.sender.findMany({ where: { ownerId: owner.id, enabled: true }, orderBy: { createdAt: 'asc' } });
const labels = ['Outbound Primary', 'Outbound Secondary'];
for (let index = existing.length; index < 2; index += 1) {
  const label = labels[index]!;
  const account = await nodemailer.createTestAccount();
  await prisma.sender.upsert({
    where: { ownerId_email: { ownerId: owner.id, email: account.user } },
    update: { enabled: true },
    create: {
      ownerId: owner.id,
      name: label,
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
  process.stdout.write(`Provisioned ${label}: ${account.user}\n`);
}
if (existing.length >= 2) process.stdout.write('Two durable Ethereal senders already exist; nothing created.\n');
await prisma.$disconnect();
