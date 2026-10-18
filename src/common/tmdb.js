import { getJson } from './http.js';

// Nuvio injects the user's/app's key as globalThis.TMDB_API_KEY; the fallback is
// the public key used by the community nuvio-providers repo.
const FALLBACK_TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

function apiKey() {
  try {
    const k = typeof globalThis !== 'undefined' && globalThis.TMDB_API_KEY;
    if (k && typeof k === 'string') return k;
  } catch (e) {}
  return FALLBACK_TMDB_KEY;
}

const cache = {};

// -> { isTv, title, originalTitle, year, titles: [...], queries: [...], imdbId }
export async function getTmdbInfo(tmdbId, mediaType) {
  const isTv = mediaType === 'tv' || mediaType === 'series';
  const key = (isTv ? 'tv:' : 'movie:') + tmdbId;
  if (cache[key]) return cache[key];

  const url =
    'https://api.themoviedb.org/3/' + (isTv ? 'tv/' : 'movie/') + encodeURIComponent(tmdbId) +
    '?api_key=' + apiKey() + '&append_to_response=alternative_titles,external_ids';
  const d = await getJson(url, { timeout: 10000 });
  if (!d || d.success === false) return null;

  const title = isTv ? d.name : d.title;
  const originalTitle = isTv ? d.original_name : d.original_title;
  const date = isTv ? d.first_air_date : d.release_date;
  const year = date ? Number(String(date).slice(0, 4)) || null : null;

  const alt = ((d.alternative_titles && (d.alternative_titles.titles || d.alternative_titles.results)) || [])
    .filter((a) => ['US', 'GB', 'IN', 'BD', 'KR', 'JP'].includes(a.iso_3166_1))
    .map((a) => a.title);

  const titles = unique([title, originalTitle, ...alt].filter(isLatinish));

  const queries = [];
  const pushQ = (q) => {
    q = String(q || '').replace(/\s+/g, ' ').trim();
    if (q && q.length >= 2 && !queries.includes(q)) queries.push(q);
  };
  pushQ(title);
  // "Mission: Impossible - Dead Reckoning" -> "Mission Impossible"
  if (/[:\-–]/.test(title || '')) pushQ(title.split(/\s*[:\-–]\s+/)[0]);
  if (originalTitle && originalTitle !== title && isLatinish(originalTitle)) pushQ(originalTitle);

  const info = {
    isTv,
    tmdbId: String(tmdbId),
    title,
    originalTitle,
    year,
    titles: titles.length ? titles : [title],
    queries,
    imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null,
  };
  cache[key] = info;
  return info;
}

function unique(arr) {
  return arr.filter((v, i) => v && arr.indexOf(v) === i);
}

// BDIX servers name folders in Latin script (plus some Bangla/Hindi)
function isLatinish(s) {
  return !!s && /[a-z0-9ঀ-৿ऀ-ॿ]/i.test(s);
}

// For search boxes that choke on punctuation: "Spider-Man: No Way Home" -> "Spider Man No Way Home"
export function plainQuery(q) {
  return String(q || '')
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
