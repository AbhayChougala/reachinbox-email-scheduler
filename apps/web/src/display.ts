export function formatSlackChannel(channelName: string): string {
  return `#${channelName.replace(/^#+/, '')}`;
}
