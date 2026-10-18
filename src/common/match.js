// Title / release-name helpers shared by all scrapers.

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv|flv)$/i;

export function isVideoFile(name) {
  return VIDEO_EXT.test(stripQuery(name));
}

function stripQuery(s) {
  return String(s || '').split(/[?#]/)[0];
}

export function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function basename(urlOrPath) {
  const parts = stripQuery(urlOrPath).replace(/\/+$/, '').split('/');
  return safeDecode(parts[parts.length - 1] || '');
}

// "Spider-Man: No Way Home" -> "spider man no way home"
export function normalize(s) {
  let t = String(s || '').toLowerCase();
  if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9ঀ-৿ऀ-ॿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripArticle(s) {
  return s.replace(/^(the|a|an) /, '');
}

const RELEASE_JUNK =
  /\b(2160p|1080p|720p|480p|360p|4k|uhd|hdr|hdr10|dv|web[ .-]?dl|web[ .-]?rip|webrip|blu[ .-]?ray|bdrip|brrip|dvdrip|hdrip|hdtv|hdts|hdtc|hdcam|camrip|cam|x264|x265|h264|h265|hevc|10bit|aac|ddp?5\.?1|dual audio|multi audio|esub|esubs|hindi|english|bangla|bengali|tamil|telugu|dubbed|org|nf|amzn|complete|tv series|tv mini series|season \d+)\b.*$/i;

// "Inception (2010) 1080p BluRay [Dual Audio].mkv" -> { title: "Inception", year: 2010 }
export function parseReleaseName(raw) {
  let s = safeDecode(String(raw || '')).replace(VIDEO_EXT, '');
  const year = extractYear(s);
  s = s.replace(/[._]/g, ' ');
  // cut at the first "(YYYY" / "[" / quality token, whichever comes first
  const cut = s.search(/[([]\s*(tv\s+(mini\s+)?series\s*)?(19|20)\d\d|\[/i);
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(RELEASE_JUNK, '');
  s = s.replace(/\b[sS]\d{1,2}([eE]\d{1,3})?\b.*$/, '');
  // scene style "Movie Name 2010" (only when there was no "(2010)" to cut at)
  if (cut <= 0) s = s.replace(/\s(?:19|20)\d\d\s*$/, '');
  return { title: s.replace(/\s+/g, ' ').trim(), year };
}

export function extractYear(s) {
  const str = String(s || '');
  const m = str.match(/[([]\s*(?:tv\s+(?:mini\s+)?series\s*)?((?:19|20)\d\d)/i) || str.match(/\b((?:19|20)\d\d)\b/);
  return m ? Number(m[1]) : null;
}

// 0..1 similarity between a candidate title and any of the wanted titles
export function titleScore(candidate, wanted) {
  const c = stripArticle(normalize(candidate));
  if (!c) return 0;
  let best = 0;
  for (const w0 of wanted) {
    const w = stripArticle(normalize(w0));
    if (!w) continue;
    if (c === w) return 1;
    if (c.replace(/ /g, '') === w.replace(/ /g, '')) {
      best = Math.max(best, 0.97);
      continue;
    }
    const cw = c.split(' ');
    const ww = w.split(' ');
    const common = ww.filter((x) => cw.includes(x)).length;
    const dice = (2 * common) / (cw.length + ww.length);
    // candidate that is the wanted title plus a short suffix ("... Extended Cut")
    if ((c.startsWith(w + ' ') || w.startsWith(c + ' ')) && Math.min(c.length, w.length) >= 4) {
      best = Math.max(best, 0.8 * dice + 0.15);
    } else {
      best = Math.max(best, 0.85 * dice);
    }
  }
  return best;
}

export function yearOk(candYear, wantYear, tolerance = 1) {
  if (!candYear || !wantYear) return true;
  return Math.abs(Number(candYear) - Number(wantYear)) <= tolerance;
}

// Score a candidate {title, year} against TMDB info; >= 0.8 is a confident match.
export function scoreCandidate(cand, info) {
  const t = titleScore(cand.title, info.titles);
  if (!t) return 0;
  if (cand.year && info.year) {
    const diff = Math.abs(cand.year - info.year);
    if (diff === 0) return Math.min(1, t + 0.05);
    if (diff === 1) return t - 0.03;
    // TV folders often carry the first-air year of the show, so only movies get hard-rejected
    return info.isTv ? t - 0.25 : 0;
  }
  return t - 0.02;
}

// S01E02, 1x02, Season 1 Episode 2, S1 EP2 -> { season, episode }
export function parseSE(name) {
  const s = safeDecode(String(name || ''));
  let m = s.match(/\bS(\d{1,2})[ ._-]*E[Pp]?[ ._-]*(\d{1,4})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = s.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = s.match(/season[ ._-]*(\d{1,2}).*?ep(?:isode)?[ ._-]*(\d{1,4})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = s.match(/\b(?:ep|episode|e)[ ._-]*(\d{1,4})\b/i);
  if (m) return { season: null, episode: +m[1] };
  return null;
}

export function parseSeasonNumber(name) {
  const s = safeDecode(String(name || ''));
  let m = s.match(/season[ ._-]*(\d{1,2})/i) || s.match(/\bS(\d{1,2})\b/i) || s.match(/\bseries[ ._-]*(\d{1,2})\b/i);
  return m ? +m[1] : null;
}

export function episodeMatches(name, season, episode) {
  const se = parseSE(name);
  if (!se) return false;
  if (se.episode !== Number(episode)) return false;
  return se.season == null || se.season === Number(season);
}

export function detectQuality(s) {
  const t = String(s || '').toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(t)) return '2160p';
  if (/1080p/.test(t)) return '1080p';
  if (/720p/.test(t)) return '720p';
  if (/576p/.test(t)) return '576p';
  if (/480p/.test(t)) return '480p';
  if (/360p/.test(t)) return '360p';
  if (/hdcam|hdts|hdtc|\bcam\b|telesync/.test(t)) return 'CAM';
  return 'Unknown';
}

export function qualityFromHeight(h) {
  h = Number(h) || 0;
  if (h >= 1600) return '2160p';
  if (h >= 900) return '1080p';
  if (h >= 650) return '720p';
  if (h >= 420) return '480p';
  if (h > 0) return h + 'p';
  return 'Unknown';
}

export function formatSize(bytes) {
  const b = Number(bytes);
  if (!b || b <= 0) return undefined;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i >= 3 ? 2 : 0) + ' ' + units[i];
}

const QUALITY_RANK = { '2160p': 6, '1080p': 5, '720p': 4, '576p': 3, '480p': 2, '360p': 1, CAM: 0, Unknown: 0 };

export function sortStreams(streams) {
  return streams.sort((a, b) => (QUALITY_RANK[b.quality] || 0) - (QUALITY_RANK[a.quality] || 0));
}

export function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter((s) => {
    if (!s || !s.url || seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
