import { encryptSecret, getConfig, prisma } from '../packages/shared/src/index.ts';

try { process.loadEnvFile?.('.env'); } catch (error) { void error; }

const ownerEmail = process.argv[2]?.trim().toLowerCase();
if (!ownerEmail) throw new Error('Usage: npm run db:rotate:senders -- <owner-email>');

const env = getConfig();
const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true } });
if (!owner) throw new Error('The requested owner does not exist');

const brokenSenders = await prisma.sender.findMany({
  where: { ownerId: owner.id, enabled: true },
  orderBy: { createdAt: 'asc' }
});
if (brokenSenders.length !== 2) {
  throw new Error(`Expected exactly two enabled senders for rotation; found ${brokenSenders.length}`);
}

process.env.ETHEREAL_CACHE = 'no';
const nodemailer = (await import('nodemailer')).default;
const replacements = await Promise.all(brokenSenders.map(() => nodemailer.createTestAccount()));

for (const account of replacements) {
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

const result = await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.id} FOR UPDATE`;
  const current = await tx.sender.findMany({
    where: { id: { in: brokenSenders.map((sender) => sender.id) }, ownerId: owner.id, enabled: true },
    orderBy: { createdAt: 'asc' }
  });
  if (current.length !== brokenSenders.length || current.some((sender, index) => sender.id !== brokenSenders[index]!.id)) {
    throw new Error('Enabled sender state changed during credential verification; no records were rotated');
  }

  const created = [];
  for (let index = 0; index < current.length; index += 1) {
    const oldSender = current[index]!;
    const account = replacements[index]!;
    created.push(await tx.sender.create({
      data: {
        ownerId: owner.id,
        name: oldSender.name,
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpSecure: account.smtp.secure,
        smtpUsernameEnc: encryptSecret(account.user, env.INTEGRATION_ENCRYPTION_KEY),
        smtpPasswordEnc: encryptSecret(account.pass, env.INTEGRATION_ENCRYPTION_KEY),
        minIntervalMs: oldSender.minIntervalMs,
        hourlyLimit: oldSender.hourlyLimit,
        enabled: true
      }
    }));
  }

  const reassigned: Array<{ id: string; recipient: string; replacementSenderId: string }> = [];
  for (let index = 0; index < current.length; index += 1) {
    const pending = await tx.emailMessage.findMany({
      where: { ownerId: owner.id, senderId: current[index]!.id, status: { in: ['SCHEDULED', 'QUEUED'] } },
      select: { id: true, recipient: true }
    });
    for (const message of pending) {
      const updated = await tx.emailMessage.update({
        where: { id: message.id },
        data: { senderId: created[index]!.id, statusVersion: { increment: 1 } }
      });
      await tx.outboxEvent.create({
        data: {
          kind: 'EMAIL_INDEX',
          aggregateId: `${updated.id}-${updated.statusVersion}`,
          payload: { messageId: updated.id, version: updated.statusVersion }
        }
      });
      reassigned.push({ id: message.id, recipient: message.recipient, replacementSenderId: created[index]!.id });
    }
  }

  await tx.sender.updateMany({
    where: { id: { in: current.map((sender) => sender.id) }, ownerId: owner.id },
    data: { enabled: false }
  });

  return { created, reassigned };
}, { maxWait: 10_000, timeout: 60_000 });

process.stdout.write(`${JSON.stringify({
  ownerEmail: owner.email,
  disabledSenders: brokenSenders.map((sender) => ({ name: sender.name, email: sender.email })),
  enabledSenders: result.created.map((sender) => ({
    name: sender.name,
    email: sender.email,
    hourlyLimit: sender.hourlyLimit,
    minIntervalMs: sender.minIntervalMs,
    smtpVerification: 'PASS'
  })),
  reassignedPendingMessages: result.reassigned.map((message) => ({
    idSuffix: message.id.slice(-8),
    recipient: message.recipient,
    replacementSenderIdSuffix: message.replacementSenderId.slice(-8)
  }))
}, null, 2)}\n`);

await prisma.$disconnect();
