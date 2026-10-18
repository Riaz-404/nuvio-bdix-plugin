// DhakaFlix (BDIX) — four h5ai servers at 172.16.50.x
// Port of the DhakaFlix providers in niloy-cloudstream / Redowan-CloudStream.
import { mapLimit } from '../common/http.js';
import { h5aiSearch, h5aiList, videoFiles } from '../common/h5ai.js';
import { plainQuery } from '../common/tmdb.js';
import {
  parseReleaseName, scoreCandidate, parseSeasonNumber, episodeMatches, detectQuality, isVideoFile,
} from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'dhakaflix';
const SERVERS = [
  { n: 7, origin: 'http://172.16.50.7', root: '/DHAKA-FLIX-7/' }, // English / foreign / Kolkata movies
  { n: 9, origin: 'http://172.16.50.9', root: '/DHAKA-FLIX-9/' }, // Anime, Korean, documentary, WWE
  { n: 12, origin: 'http://172.16.50.12', root: '/DHAKA-FLIX-12/' }, // TV & web series
  { n: 14, origin: 'http://172.16.50.14', root: '/DHAKA-FLIX-14/' }, // Hindi, South, 1080p English, animation
];

// Search patterns to try in order. h5ai matches the pattern as a PCRE regex against each
// file/folder name, so "spider.*man.*no.*way.*home" also finds "Spider-Man No Way Home (2021)".
function patterns(info) {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };
  for (const q of info.queries) add(plainQuery(q).split(' ').filter(Boolean).join('.*'));
  const words = plainQuery(info.title).split(' ').filter(Boolean);
  const longest = words.slice().sort((a, b) => b.length - a.length)[0];
  if (words.length > 1 && longest && longest.length >= 5) add(longest);
  return out.slice(0, 3);
}

async function searchServer(server, info) {
  const seen = new Set();
  const hits = [];
  for (const pattern of patterns(info)) {
    const results = await h5aiSearch(server.origin, server.root, pattern);
    if (results == null) break; // server unreachable from this network
    for (const r of results) {
      if (seen.has(r.href)) continue;
      seen.add(r.href);
      const isDir = r.size == null || /\/$/.test(r.href);
      if (!isDir && (info.isTv || !isVideoFile(r.href))) continue;
      const parsed = parseReleaseName(r.href.replace(/\/$/, '').split('/').pop());
      // skip bare "Season 1" folders; we want the show folder itself
      if (isDir && parseSeasonNumber(parsed.title) != null && parsed.title.split(' ').length <= 3) continue;
      const score = scoreCandidate(parsed, info);
      if (score >= 0.8) hits.push({ server, href: r.href, isDir, size: r.size, score });
    }
    if (hits.length) break;
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}

function label(server) {
  return 'BDIX | DhakaFlix ' + server.n;
}

function fileStream(server, entry) {
  return makeStream({
    provider: ID,
    label: label(server),
    url: server.origin + entry.href,
    title: entry.name,
    quality: detectQuality(entry.name + ' ' + decodeURIComponent(entry.href)),
    size: entry.size != null ? entry.size : entry.sizeText,
  });
}

async function movieStreams(hit) {
  const { server } = hit;
  if (!hit.isDir) return [fileStream(server, { href: hit.href, name: hit.href.split('/').pop(), size: hit.size })];
  const entries = await h5aiList(server.origin, hit.href);
  let files = videoFiles(entries);
  if (!files.length) {
    // one level deeper, e.g. ".../Movie (2020)/1080p/"
    const subdirs = entries.filter((e) => e.isDir).slice(0, 3);
    const nested = await mapLimit(subdirs, 3, (d) => h5aiList(server.origin, d.href));
    files = nested.flatMap((list) => videoFiles(list || []));
  }
  return files.map((f) => fileStream(server, f));
}

async function episodeStreams(hit, season, episode) {
  const { server } = hit;
  if (!hit.isDir) return [];
  const entries = await h5aiList(server.origin, hit.href);
  const seasonDirs = entries.filter((e) => e.isDir && parseSeasonNumber(e.name) === season);
  let files = videoFiles(entries).filter((f) => episodeMatches(f.name, season, episode));
  const lists = await mapLimit(seasonDirs.slice(0, 3), 3, (d) => h5aiList(server.origin, d.href));
  for (const list of lists) {
    const vids = videoFiles(list || []);
    let match = vids.filter((f) => episodeMatches(f.name, season, episode));
    // files named only "Episode 05" / "05.mkv" inside a season folder
    if (!match.length) match = vids.filter((f) => new RegExp('(^|\\D)0*' + episode + '(\\D|$)').test(f.name.replace(/\b(19|20)\d\d\b|\d{3,4}p/g, '')) && !/S\d+E\d+/i.test(f.name)).slice(0, 1);
    files = files.concat(match);
  }
  return files.map((f) => fileStream(server, f));
}

async function run(info, season, episode) {
  const perServer = await Promise.all(SERVERS.map((s) => searchServer(s, info).catch(() => [])));
  const hits = perServer.flat();
  const results = await mapLimit(hits, 4, (h) => (info.isTv ? episodeStreams(h, season, episode) : movieStreams(h)));
  return results.flat().filter(Boolean);
}

export const getStreams = createProvider(ID, run);
