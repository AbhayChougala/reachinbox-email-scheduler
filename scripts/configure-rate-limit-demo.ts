import { createRedis, getConfig, prisma } from '../packages/shared/src/index.ts';

try { process.loadEnvFile?.('.env'); } catch (error) { void error; }
const env = getConfig();
const redis = createRedis(env.REDIS_URL);

try {
  const owners = await prisma.user.findMany({
    where: { googleSubject: { not: null } },
    select: {
      id: true,
      senders: {
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, hourlyLimit: true }
      }
    }
  });
  if (owners.length !== 1) throw new Error(`Expected exactly one Google-authenticated user, found ${owners.length}`);

  const position = Number(process.env.DEMO_SENDER_POSITION ?? '1');
  if (!Number.isInteger(position) || position < 1) throw new Error('DEMO_SENDER_POSITION must be a positive integer');
  const sender = owners[0]!.senders[position - 1];
  if (!sender) throw new Error(`No enabled sender exists at position ${position}`);

  const hourSuffix = new Date().toISOString().slice(0, 13);
  const consumed = Number(await redis.get(`rate:sender:${sender.id}:${hourSuffix}`) ?? '0');
  if (consumed !== 0) {
    throw new Error(`Selected sender has already consumed ${consumed} slot(s) in the current UTC hour; no data or quota state was changed`);
  }

  await prisma.sender.update({ where: { id: sender.id }, data: { hourlyLimit: 2 } });
  process.stdout.write(`Configured ${sender.name} with a sender-wide cap of 2; current UTC-hour consumption remains ${consumed}.\n`);
} finally {
  await redis.quit();
  await prisma.$disconnect();
}
