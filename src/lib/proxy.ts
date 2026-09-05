/**
 * Proxy URL scheme shared by the shell and /public/sw.js.
 * Proxied link form:  /wisp/<base64url(raw-url)>
 * The service worker owns that prefix: it fetches the target,
 * strips framing headers, and rewrites every embedded absolute
 * URL so subresources recurse through the tunnel.
 */

export const PROXY_PREFIX = "/wisp/";

export function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromB64url(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))));
}

/** Raw URL -> proxied link (what the iframe actually loads). */
export function toProxyUrl(url: string): string {
  if (!url) return url;
  return PROXY_PREFIX + b64url(url);
}

/** Proxied link -> raw URL (for display, history, copying). */
export function fromProxyUrl(u: string): string {
  try {
    const p = new URL(u, location.origin).pathname;
    if (p.startsWith(PROXY_PREFIX)) return fromB64url(p.slice(PROXY_PREFIX.length));
  } catch {
    /* keep raw */
  }
  return u;
}

export function isProxied(u: string): boolean {
  try {
    return new URL(u, location.origin).pathname.startsWith(PROXY_PREFIX);
  } catch {
    return false;
  }
}
