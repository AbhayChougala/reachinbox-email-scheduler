export function formatSlackChannel(channelName: string): string {
  return `#${channelName.replace(/^#+/, '')}`;
}

export function emailTimestampForTab(
  tab: 'scheduled' | 'sent',
  item: { status: string; effectiveScheduledAt: string; sentAt?: string | null }
): string | null {
  if (tab === 'scheduled') return item.effectiveScheduledAt;
  return item.status === 'SENT' ? item.sentAt ?? null : null;
}

export function emailViewKey(tab: 'scheduled' | 'sent', query: string, page: number): string {
  return `${tab}\u0000${query}\u0000${page}`;
}

export function currentEmailResults<T extends { key: string }>(viewKey: string, results: T | null): T | null {
  return results?.key === viewKey ? results : null;
}
