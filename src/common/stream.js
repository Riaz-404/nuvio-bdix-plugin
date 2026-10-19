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
      // No deadline timer here: in Nuvio a pending timer would hold the call open until it
      // fires. Nuvio already stops a scraper after 60 s.
      const streams = finalize((await run(info, s, e)) || []);
      console.log('[' + id + '] ' + info.title + (info.isTv ? ' S' + s + 'E' + e : '') + ': ' + streams.length + ' streams');
      return streams;
    } catch (err) {
      console.log('[' + id + '] error: ' + (err && err.message ? err.message : err));
      return [];
    }
  };
}
