// ICC FTP (BDIX) — PHP site at 10.16.100.244
// Port of redowan99/Redowan-CloudStream BdixICCFtp.
import { getText, getJson, formBody, absUrl, mapLimit } from '../common/http.js';
import { scoreCandidate, episodeMatches, parseSE, isVideoFile, decodeEntities, detectQuality, basename } from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'iccftp';
const LABEL = 'BDIX | ICC FTP';
const BASE = 'http://10.16.100.244/';

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function search(info) {
  const found = new Map();
  for (const q of info.queries) {
    const list = await getJson(BASE + 'command.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ cSearch: q }),
      timeout: 15000,
    });
    if (list == null) break; // unreachable
    for (const it of Array.isArray(list) ? list : []) if (it && it.id && !found.has(it.id)) found.set(it.id, it);
    if (found.size) break;
  }
  return [...found.values()]
    .map((it) => ({ it, s: scoreCandidate({ title: decodeEntities(it.name || ''), year: null }, info) }))
    .filter((x) => x.s >= 0.8)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => x.it);
}

// player.php?play=<id>: info table + a download button (movie) or a dropdown of episodes (series)
function parsePlayer(html, pageUrl) {
  const table = (html.match(/<table[^>]*class="[^"]*\btable\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i) || [])[1] || '';
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1])));
  const title = rows[0] ? rows[0].join(' ') : '';
  const year = rows[1] && rows[1][1] ? Number((rows[1][1].match(/(19|20)\d\d/) || [])[0]) || null : null;

  const episodes = [];
  const group = html.match(/class="[^"]*btn-group[^"]*"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
  if (group) {
    for (const li of group[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const a = li[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const span = stripTags((a[2].match(/<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '');
      episodes.push({ url: absUrl(decodeEntities(a[1]), pageUrl), name: stripTags(a[2]).replace(span, '').trim() });
    }
  }
  let movie = null;
  if (!episodes.length) {
    const btns = [...html.matchAll(/<a[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bbtn\b[^"]*"/gi)]
      .map((m) => absUrl(decodeEntities(m[1] || m[2]), pageUrl));
    movie = btns.find((u) => isVideoFile(u)) || btns.find((u) => /^https?:/.test(u) && !/player\.php|index\.php|#/.test(u)) || null;
  }
  return { title, year, episodes, movie };
}

async function run(info, season, episode) {
  const items = await search(info);
  const pages = await mapLimit(items, 4, async (it) => {
    const url = BASE + 'player.php?play=' + it.id;
    const html = await getText(url, { timeout: 15000 });
    return html ? parsePlayer(html, url) : null;
  });
  const streams = [];
  pages.forEach((p, i) => {
    if (!p) return;
    if (p.year && info.year && !info.isTv && Math.abs(p.year - info.year) > 1) return;
    const name = items[i].name;
    if (!info.isTv && p.movie) {
      streams.push(makeStream({ provider: ID, label: LABEL, url: p.movie, title: basename(p.movie) || name, quality: detectQuality(p.movie + ' ' + name) }));
    }
    if (info.isTv && p.episodes.length) {
      let eps = p.episodes.filter((e) => episodeMatches(e.name + ' ' + basename(e.url), season, episode));
      // unnumbered single-season lists: fall back to position
      if (!eps.length && season === 1 && p.episodes.every((e) => !parseSE(e.name) && !parseSE(basename(e.url)))) {
        eps = p.episodes[episode - 1] ? [p.episodes[episode - 1]] : [];
      }
      for (const e of eps) streams.push(makeStream({ provider: ID, label: LABEL, url: e.url, title: basename(e.url) || e.name }));
    }
  });
  return streams;
}

export const getStreams = createProvider(ID, run);
