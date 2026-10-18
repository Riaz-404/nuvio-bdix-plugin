// Minimal h5ai client (DhakaFlix and similar BDIX index servers).
import { postJson, getText } from './http.js';
import { basename, decodeEntities, isVideoFile } from './match.js';

// Recursive server-side search. Returns [{ href, size }] (folders have size == null),
// or null when the server can't be reached.
export async function h5aiSearch(origin, root, pattern, timeout = 15000) {
  const data = await postJson(
    origin + root,
    { action: 'get', search: { href: root, pattern, ignorecase: true } },
    { timeout }
  );
  if (!data) return null;
  return (Array.isArray(data.search) ? data.search : []).filter((x) => x && x.href);
}

function toEntry(href, size, isDirHint) {
  const isDir = isDirHint != null ? isDirHint : /\/$/.test(href);
  return { href, name: basename(href), size: size == null ? null : size, isDir };
}

// Direct children of a folder: [{ href, name, size, isDir }]
export async function h5aiList(origin, href) {
  // JSON API first ("what": 1 = folder plus its direct children)
  const data = await postJson(origin + href, { action: 'get', items: { href, what: 1 } }, { timeout: 15000 });
  if (data && Array.isArray(data.items)) {
    const kids = data.items.filter((it) => {
      if (!it || !it.href || it.href === href || !it.href.startsWith(href)) return false;
      const rest = it.href.slice(href.length).replace(/\/$/, '');
      return rest && !rest.includes('/');
    });
    if (kids.length) return kids.map((it) => toEntry(it.href, it.size));
  }

  // Fallback: the no-JS HTML table (td.fb-n > a)
  const html = await getText(origin + href, { timeout: 15000 });
  if (!html) return [];
  const out = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const a = row.match(/class="fb-n"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const link = decodeEntities(a[1]);
    if (link === '..' || link === '../' || href.startsWith(link)) continue; // parent dir
    const full = link.startsWith('/') ? link : href + link;
    const isDir = /alt="folder"/i.test(row) || /\/$/.test(full);
    const sizeText = (row.match(/class="fb-s"[^>]*>([^<]*)</i) || [])[1];
    out.push({ ...toEntry(full, null, isDir), sizeText: sizeText ? sizeText.trim() : undefined });
  }
  return out;
}

export function videoFiles(entries) {
  return entries.filter((e) => !e.isDir && isVideoFile(e.name) && !/\bsample\b|trailer/i.test(e.name));
}
