import { detectQuality, formatSize, basename, dedupeStreams, sortStreams } from './match.js';
import { getTmdbInfo } from './tmdb.js';

// Build a Nuvio stream object.
export function makeStream({ provider, label, url, title, quality, size, headers }) {
  const fileTitle = title || basename(url);
  const s = {
    name: label,
    title: fileTitle,
    url,
    quality: quality || detectQuality(fileTitle + ' ' + url),
    type: 'direct',
    provider,
  };
  const sz = typeof size === 'number' ? formatSize(size) : size;
  if (sz) s.size = sz;
  if (headers && Object.keys(headers).length) s.headers = headers;
  return s;
}

export function finalize(streams) {
  return sortStreams(dedupeStreams(streams.filter(Boolean)));
}

// Nuvio kills a scraper call after 60 s; give up a little earlier and return nothing.
const DEADLINE_MS = 50000;

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Standard getStreams wrapper: resolve TMDB, run the source, never throw.
export function createProvider(id, run) {
  return async function getStreams(tmdbId, mediaType, season, episode) {
    try {
      const info = await getTmdbInfo(tmdbId, mediaType);
      if (!info || !info.title) {
        console.log('[' + id + '] TMDB lookup failed for ' + tmdbId);
        return [];
      }
      const s = season == null ? null : Number(season);
      const e = episode == null ? null : Number(episode);
      if (info.isTv && (!s || !e)) return [];
      const streams = finalize((await withDeadline(run(info, s, e), DEADLINE_MS)) || []);
      console.log('[' + id + '] ' + info.title + (info.isTv ? ' S' + s + 'E' + e : '') + ': ' + streams.length + ' streams');
      return streams;
    } catch (err) {
      console.log('[' + id + '] error: ' + (err && err.message ? err.message : err));
      return [];
    }
  };
}
