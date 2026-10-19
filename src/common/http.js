// Thin wrapper around the runtime's fetch (native in Nuvio, global in Node 18+).
// Never throws for network problems: callers get null and decide what to do.

export const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// Inside Nuvio, fetch ignores AbortSignal, and every setTimeout is a native sleep that
// keeps the plugin call open until it elapses (clearTimeout doesn't stop it). So timeouts
// are only applied outside Nuvio (Node test scripts); in Nuvio the native HTTP client's
// own timeouts and the 60 s plugin limit apply.
const IN_NUVIO = typeof globalThis !== 'undefined' && typeof globalThis.__native_fetch === 'function';

export async function request(url, opts = {}) {
  const { timeout = 15000, headers = {}, ...rest } = opts;
  const controller = !IN_NUVIO && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { 'User-Agent': UA, ...headers },
      signal: controller ? controller.signal : undefined,
    });
    // Nuvio reports network failures as status 0 instead of throwing
    if (!res || !res.status) return null;
    return res;
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res || !res.ok) return null;
  try {
    return await res.text();
  } catch (e) {
    return null;
  }
}

export async function getJson(url, opts = {}) {
  const text = await getText(url, opts);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export function postJson(url, body, opts = {}) {
  return getJson(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  });
}

export function formBody(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

// Collect "name=value" pairs from Set-Cookie, whether the runtime exposes them
// as an array (getSetCookie) or as one comma-joined header.
export function readCookies(res) {
  if (!res || !res.headers) return '';
  let list = [];
  if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie() || [];
  if (!list.length) {
    const raw = res.headers.get('set-cookie');
    if (raw) list = raw.split(/,(?=\s*[^;,=\s]+=)/);
  }
  return list
    .map((c) => c.split(';')[0].trim())
    .filter((c) => c.includes('='))
    .join('; ');
}

export function absUrl(href, base) {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return (base.startsWith('https') ? 'https:' : 'http:') + href;
  const origin = base.match(/^https?:\/\/[^/]+/i)[0];
  if (href.startsWith('/')) return origin + href;
  return base.replace(/[^/]*$/, '') + href;
}

// Run async tasks with a concurrency cap; failures become undefined.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = undefined;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// HEAD a stream URL; false only when the server says it's gone (unknown counts as alive).
export async function isAlive(url, headers = {}) {
  const res = await request(url, { method: 'HEAD', headers, timeout: 6000 });
  if (!res) return true;
  return !(res.status === 404 || res.status === 410);
}
