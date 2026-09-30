export function canonicalPublicUrl(requestHost: string | undefined, requestUrl: string, publicOrigin: URL | undefined): string | null {
  if (!requestHost || !publicOrigin) return null;
  const hostname = requestHost.startsWith('[')
    ? requestHost.slice(1, requestHost.indexOf(']'))
    : requestHost.split(':')[0]!;
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!loopback || hostname === publicOrigin.hostname) return null;
  return new URL(requestUrl, publicOrigin).href;
}
