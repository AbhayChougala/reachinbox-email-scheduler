import { z } from 'zod';

export const scheduleSchema = z.object({
  senderId: z.string().min(1),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  recipients: z.array(z.string()).min(1),
  startAtUtc: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
  delaySeconds: z.number().int().min(0).max(86_400),
  hourlyLimit: z.number().int().min(1).max(10_000)
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).default(''),
  tab: z.enum(['scheduled', 'sent']).default('scheduled')
});
