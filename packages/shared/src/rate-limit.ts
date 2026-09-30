import type { Redis } from 'ioredis';

const ADMIT_SCRIPT = `
local now = tonumber(redis.call('TIME')[1]) * 1000 + math.floor(tonumber(redis.call('TIME')[2]) / 1000)
local senderCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local campaignCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local last = tonumber(redis.call('GET', KEYS[3]) or '0')
local senderLimit = tonumber(ARGV[1])
local campaignLimit = tonumber(ARGV[2])
local minInterval = tonumber(ARGV[3])
local nextHour = tonumber(ARGV[4])
if senderCount >= senderLimit then return {0, nextHour, 1, senderCount} end
if campaignCount >= campaignLimit then return {0, nextHour, 2, senderCount} end
if last > 0 and now < last + minInterval then return {0, last + minInterval, 3, senderCount} end
senderCount = redis.call('INCR', KEYS[1])
campaignCount = redis.call('INCR', KEYS[2])
redis.call('PEXPIREAT', KEYS[1], nextHour + 60000)
redis.call('PEXPIREAT', KEYS[2], nextHour + 60000)
redis.call('SET', KEYS[3], now, 'PX', math.max(minInterval * 2, 60000))
local reached = 0
if senderCount == senderLimit then reached = 1 end
return {1, now, 0, senderCount, reached}
`;

export type Admission = {
  allowed: boolean;
  nextEligibleAt: number;
  reason: 'sender-hourly-limit' | 'campaign-hourly-limit' | 'sender-minimum-spacing' | null;
  senderCount: number;
  senderThresholdReached: boolean;
  utcHour: Date;
};

export async function admitSend(redis: Redis, input: {
  senderId: string;
  campaignId: string;
  senderHourlyLimit: number;
  campaignHourlyLimit: number;
  minIntervalMs: number;
  now?: Date;
}): Promise<Admission> {
  const now = input.now ?? new Date();
  const utcHour = new Date(now);
  utcHour.setUTCMinutes(0, 0, 0);
  const nextHour = utcHour.getTime() + 3_600_000;
  const suffix = utcHour.toISOString().slice(0, 13);
  const result = await redis.eval(
    ADMIT_SCRIPT,
    3,
    `rate:sender:${input.senderId}:${suffix}`,
    `rate:campaign:${input.campaignId}:${suffix}`,
    `rate:sender:${input.senderId}:last`,
    input.senderHourlyLimit,
    input.campaignHourlyLimit,
    input.minIntervalMs,
    nextHour
  ) as number[];
  const reasonMap: Record<number, Admission['reason']> = { 0: null, 1: 'sender-hourly-limit', 2: 'campaign-hourly-limit', 3: 'sender-minimum-spacing' };
  return {
    allowed: result[0] === 1,
    nextEligibleAt: Number(result[1]),
    reason: reasonMap[Number(result[2])] ?? null,
    senderCount: Number(result[3]),
    senderThresholdReached: result[4] === 1,
    utcHour
  };
}
