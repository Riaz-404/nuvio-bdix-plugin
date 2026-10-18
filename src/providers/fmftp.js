// FMFTP (BDIX) — JSON API at fmftp.net
// Port of Niloy-Sarker/niloy-cloudstream FMFTP.
import { getJson, request, mapLimit } from '../common/http.js';
import { scoreCandidate, detectQuality, basename, safeDecode } from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'fmftp';
const LABEL = 'BDIX | FMFTP';
const BASE = 'https://fmftp.net';
const STREAM_HEADERS = { Referer: BASE };

function isMovie(item) {
  return item.type === 'movie' || (item.Library && item.Library.type === 'MOVIE');
}

async function search(info) {
  const found = new Map();
  for (const q of info.queries) {
    const list = await getJson(BASE + '/api/search?search=' + encodeURIComponent(q).replace(/%20/g, '+'), { timeout: 15000 });
    if (list == null) break; // unreachable
    for (const it of Array.isArray(list) ? list : []) {
      if (isMovie(it) === info.isTv || found.has(it.id)) continue;
      found.set(it.id, it);
    }
    if ([...found.values()].some((it) => String(it.tmdb_id) === info.tmdbId)) break;
  }
  const items = [...found.values()];
  const exact = items.filter((it) => it.tmdb_id != null && String(it.tmdb_id) === info.tmdbId);
  if (exact.length) return exact;
  return items
    .filter((it) => !it.tmdb_id)
    .map((it) => ({ it, s: scoreCandidate({ title: it.title, year: Number(it.year) || null }, info) }))
    .filter((x) => x.s >= 0.85)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.it);
}

// The stream endpoint answers with a 302 to the file server. Resolve it up front (players
// often refuse https -> http redirects); HEAD so a direct 200 never downloads the file.
async function resolve(endpoint) {
  const res = await request(endpoint, { method: 'HEAD', redirect: 'manual', headers: STREAM_HEADERS, timeout: 10000 });
  const loc = res && res.headers && res.headers.get('location');
  if (loc) {
    if (loc.startsWith('//')) return 'https:' + loc;
    if (loc.startsWith('/')) return BASE + loc;
    return loc;
  }
  if (res && res.url && res.url !== endpoint && /^https?:/.test(res.url)) return res.url;
  return endpoint;
}

async function run(info, season, episode) {
  const items = await search(info);
  const targets = [];
  if (!info.isTv) {
    for (const it of items) targets.push({ type: 'movies', id: it.id, name: it.title + (it.year ? ' (' + it.year + ')' : '') });
  } else {
    const shows = await mapLimit(items, 2, (it) => getJson(BASE + '/api/tv-shows/' + it.id + '?fields=episodes', { timeout: 15000 }));
    shows.forEach((show, i) => {
      for (const ep of (show && show.episodes) || []) {
        if (Number(ep.season_number) === season && Number(ep.episode_number) === episode) {
          targets.push({ type: 'tv_shows', id: ep.id, name: items[i].title + ' S' + season + 'E' + episode + (ep.name ? ' - ' + ep.name : '') });
        }
      }
    });
  }
  const urls = await mapLimit(targets, 4, (t) => resolve(BASE + '/api/stream/video/stream?type=' + t.type + '&id=' + t.id));
  return targets.map((t, i) => {
    const url = urls[i];
    if (!url) return null;
    const file = basename(url);
    return makeStream({
      provider: ID,
      label: LABEL,
      url,
      title: /\.\w{2,4}$/.test(file) ? safeDecode(file) : t.name,
      quality: detectQuality(url),
      headers: STREAM_HEADERS,
    });
  });
}

export const getStreams = createProvider(ID, run);
