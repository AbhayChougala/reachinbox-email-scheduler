export function buildEmailSearch(input: {
  ownerId: string;
  tab: 'scheduled' | 'sent';
  q: string;
  page: number;
  pageSize: number;
}) {
  const statuses = input.tab === 'sent' ? ['SENT', 'FAILED'] : ['SCHEDULED', 'QUEUED', 'SENDING'];
  const contentQuery = input.q
    ? { multi_match: { query: input.q, fields: ['recipient^3', 'subject^2', 'body'] } }
    : { match_all: {} };
  return {
    from: (input.page - 1) * input.pageSize,
    size: input.pageSize,
    query: { bool: { must: [contentQuery], filter: [{ term: { ownerId: input.ownerId } }, { terms: { status: statuses } }] } },
    sort: input.tab === 'sent' ? [{ sentAt: { order: 'desc' as const, missing: '_last' as const } }] : [{ effectiveScheduledAt: 'asc' as const }]
  };
}
