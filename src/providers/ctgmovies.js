// CTGMovies — Next.js site; stream data lives in the RSC payload (self.__next_f.push chunks).
// Port of Niloy-Sarker/niloy-cloudstream CTGMovies.
import { getText, mapLimit, isAlive } from '../common/http.js';
import { titleScore, detectQuality, basename } from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'ctgmovies';
const LABEL = 'CTGMovies';
const BASE = 'https://ctgmovies.com';
const STREAM_HEADERS = { Referer: BASE + '/' };

// Search page -> [{ href, title }]
function parseSearch(html, isTv) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href="(\/(movies|tv|anime)\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [, href, kind, inner] = m;
    if (seen.has(href)) continue;
    if (isTv ? kind === 'movies' : kind === 'tv') continue;
    const alt = (inner.match(/<img[^>]*\balt="([^"]*)"/i) || [])[1] || '';
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    seen.add(href);
    out.push({ href, title: alt || text || href.split('/').pop().replace(/-/g, ' ') });
  }
  return out;
}

// Rebuild the RSC payload and return every parsed JSON row.
function parseRsc(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let payload = '';
  let m;
  while ((m = re.exec(html))) {
    try {
      payload += JSON.parse('"' + m[1] + '"');
    } catch (e) {}
  }
  // Text rows ("63:T48f,<text>") are length-prefixed with no trailing newline, so a JSON
  // row can start mid-line; try every "<hex>:[" / "<hex>:{" position until one parses.
  const rows = [];
  for (const line of payload.split('\n')) {
    const starts = /([0-9a-fA-F]+):([[{])/g;
    let m2;
    while ((m2 = starts.exec(line))) {
      const at = m2.index + m2[1].length + 1;
      if (m2.index > 0 && /[0-9a-fA-F]/.test(line[m2.index - 1])) continue;
      try {
        rows.push(JSON.parse(line.slice(at)));
        break;
      } catch (e) {}
    }
  }
  return rows;
}

// Walk the tree collecting media objects (anything with a tmdb_id), links and episodes.
function extractMedia(rows) {
  const result = { media: [], links: [], episodes: [] };
  const seenLinks = new Set();
  const stack = [...rows];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const x of node) stack.push(x);
      continue;
    }
    if (node.tmdb_id != null && (node.slug || Array.isArray(node.links))) result.media.push(node);
    if (Array.isArray(node.episodes)) {
      for (const ep of node.episodes) if (ep && Array.isArray(ep.links)) result.episodes.push(ep);
    }
    if (Array.isArray(node.links) && node.episode_number == null) {
      for (const l of node.links) {
        if (l && typeof l.url === 'string' && l.url && !seenLinks.has(l.url)) {
          seenLinks.add(l.url);
          result.links.push(l);
        }
      }
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return result;
}

function usableLink(l) {
  if (!l || !l.url || l.broken === true) return false;
  const u = l.url.toLowerCase();
  if (/\.(srt|vtt|ass)(\?|$)/.test(u) || u.includes('.audio.')) return false;
  return /^https?:\/\//.test(l.url);
}

function linkToStream(l) {
  const subs = (l.subtitle_tracks || [])
    .filter((t) => t && t.url)
    .map((t) => ({ url: t.url, language: t.language || t.label || 'Unknown', name: t.label || t.language }));
  const s = makeStream({
    provider: ID,
    label: LABEL + (l.source ? ' (' + String(l.source).replace(/^auto:/, '') + ')' : ''),
    url: l.url,
    title: basename(l.url),
    quality: detectQuality((l.quality || '') + ' ' + l.url),
    size: l.size_bytes || undefined,
    headers: STREAM_HEADERS,
  });
  if (l.language) s.language = l.language;
  if (subs.length) s.subtitles = subs;
  return s;
}

async function run(info, season, episode) {
  const candidates = [];
  for (const q of info.queries) {
    const html = await getText(BASE + '/search?q=' + encodeURIComponent(q), { timeout: 15000 });
    if (!html) break;
    for (const c of parseSearch(html, info.isTv)) {
      if (!candidates.some((x) => x.href === c.href)) candidates.push({ ...c, score: titleScore(c.title, info.titles) });
    }
    if (candidates.some((c) => c.score >= 0.8)) break;
  }
  const top = candidates.filter((c) => c.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 4);

  const pages = await mapLimit(top, 4, async (c) => {
    const html = await getText(BASE + c.href, { timeout: 20000 });
    return html ? extractMedia(parseRsc(html)) : null;
  });

  // Use pages that carry a media object with our tmdb_id; else a near-exact title with no id at all.
  const wanted = String(info.tmdbId);
  const chosen = [];
  pages.forEach((p, i) => {
    if (!p) return;
    const own = p.media.find((m) => String(m.tmdb_id) === wanted);
    if (own) chosen.push({ page: p, own });
    else if (top[i].score >= 0.95 && !p.media.some((m) => m.slug === top[i].href.split('/').pop())) chosen.push({ page: p, own: null });
  });

  const streams = [];
  for (const { page, own } of chosen) {
    if (info.isTv) {
      for (const ep of page.episodes) {
        if (own && own.id && ep.series_id && ep.series_id !== own.id) continue;
        if (Number(ep.season_number || 1) === season && Number(ep.episode_number || 1) === episode) {
          ep.links.filter(usableLink).forEach((l) => streams.push(linkToStream(l)));
        }
      }
    } else {
      // Only this title's links, not ones from "similar" cards on the same page
      const links = own && Array.isArray(own.links) && own.links.length
        ? own.links
        : page.links.filter((l) => !own || !l.movie_id || l.movie_id === own.id);
      links.filter(usableLink).forEach((l) => streams.push(linkToStream(l)));
    }
  }
  // The site keeps some dead links (e.g. its old "IMDb Top 250" disk); drop those that 404
  const alive = await mapLimit(streams, 6, (s) => isAlive(s.url, STREAM_HEADERS));
  return streams.filter((_, i) => alive[i] !== false);
}

export const getStreams = createProvider(ID, run);
