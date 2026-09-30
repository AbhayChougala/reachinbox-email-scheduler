import { prisma } from '../packages/shared/src/index.ts';

process.loadEnvFile?.('.env');

const googleOwners = await prisma.user.findMany({
  where: { googleSubject: { not: null } },
  select: { id: true, _count: { select: { senders: true } } }
});
if (googleOwners.length !== 1) throw new Error(`Expected exactly one Google-authenticated user, found ${googleOwners.length}`);
const target = googleOwners[0]!;

const sourceOwners = await prisma.user.findMany({
  where: { googleSubject: null, senders: { some: {} } },
  select: { id: true, _count: { select: { senders: true } } }
});
if (sourceOwners.length === 0) {
  process.stdout.write(`No seeded sender ownership transfer is needed; Google user owns ${target._count.senders} sender(s).\n`);
  await prisma.$disconnect();
  process.exit(0);
}
if (sourceOwners.length !== 1) throw new Error(`Expected one seed-only sender owner, found ${sourceOwners.length}`);
if (target._count.senders > 0) throw new Error('Google user already owns senders; refusing an ambiguous merge');
const source = sourceOwners[0]!;

await prisma.$transaction(async (tx) => {
  await tx.sender.updateMany({ where: { ownerId: source.id }, data: { ownerId: target.id } });
  await tx.campaign.updateMany({ where: { ownerId: source.id }, data: { ownerId: target.id } });
  await tx.emailMessage.updateMany({ where: { ownerId: source.id }, data: { ownerId: target.id } });
  await tx.scheduleRequest.updateMany({ where: { ownerId: source.id }, data: { ownerId: target.id } });
  await tx.slackNotification.updateMany({ where: { ownerId: source.id }, data: { ownerId: target.id } });
});

process.stdout.write(`Transferred ${source._count.senders} encrypted sender account(s) and their demo history to the Google-authenticated owner.\n`);
await prisma.$disconnect();
