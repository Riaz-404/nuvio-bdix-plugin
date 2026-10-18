// Circle FTP (BDIX) — JSON API behind new.circleftp.net
// Port of redowan99/Redowan-CloudStream BdixCircleftp.
import { getJson, mapLimit } from '../common/http.js';
import {
  parseReleaseName, extractYear, scoreCandidate, parseSE, parseSeasonNumber, detectQuality, basename,
} from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'circleftp';
const LABEL = 'BDIX | Circle FTP';
const API_BASES = ['http://new.circleftp.net:5000', 'http://15.1.1.50:5000'];
const STREAM_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

let workingBase = null;

async function api(path) {
  const bases = workingBase ? [workingBase, ...API_BASES.filter((b) => b !== workingBase)] : API_BASES;
  for (const base of bases) {
    const data = await getJson(base + path, { timeout: 12000 });
    if (data) {
      workingBase = base;
      return data;
    }
  }
  return null;
}

async function findPosts(info) {
  const wantType = info.isTv ? 'series' : 'singleVideo';
  const found = new Map();
  for (const q of info.queries) {
    const data = await api('/api/posts?searchTerm=' + encodeURIComponent(q) + '&order=desc');
    if (data == null) break; // unreachable
    const posts = (data && data.posts) || [];
    for (const p of posts) {
      if (p.type !== wantType || found.has(p.id)) continue;
      const parsed = parseReleaseName(p.title);
      const cand = {
        title: p.name || parsed.title,
        year: parseInt(p.year, 10) || extractYear(p.title) || parsed.year,
      };
      const score = Math.max(scoreCandidate(cand, info), scoreCandidate({ ...cand, title: parsed.title }, info));
      if (score >= 0.8) found.set(p.id, { post: p, score });
    }
    if (found.size) break;
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.post);
}

function pickEpisode(content, season, episode) {
  const seasons = (Array.isArray(content) ? content : []).filter((s) => s && Array.isArray(s.episodes) && s.episodes.length);
  const seasonOf = (s) => {
    const n = parseSeasonNumber(s.seasonName);
    if (n != null) return n;
    const se = parseSE((s.episodes[0] || {}).title) || parseSE((s.episodes[0] || {}).link);
    return se && se.season != null ? se.season : null;
  };
  let target = seasons.filter((s) => seasonOf(s) === season);
  if (!target.length && seasons.every((s) => seasonOf(s) == null) && seasons[season - 1]) target = [seasons[season - 1]];

  const hits = [];
  for (const s of target) {
    let ep = s.episodes.find((e) => {
      const se = parseSE(e.title) || parseSE(basename(e.link));
      return se && se.episode === episode && (se.season == null || se.season === season);
    });
    if (!ep && s.episodes.every((e) => !parseSE(e.title) && !parseSE(basename(e.link)))) ep = s.episodes[episode - 1];
    if (ep && ep.link) hits.push(ep);
  }
  return hits;
}

async function run(info, season, episode) {
  const posts = await findPosts(info);
  const details = await mapLimit(posts, 4, (p) => api('/api/posts/' + p.id));
  const streams = [];
  details.forEach((d, i) => {
    if (!d) return;
    const post = posts[i];
    const extra = (post.title || '') + ' ' + (d.quality || '');
    if (!info.isTv) {
      if (typeof d.content === 'string' && /^https?:\/\//.test(d.content)) {
        streams.push(makeStream({
          provider: ID, label: LABEL, url: d.content, title: post.title,
          quality: detectQuality(d.content + ' ' + extra), headers: STREAM_HEADERS,
        }));
      }
      return;
    }
    for (const ep of pickEpisode(d.content, season, episode)) {
      streams.push(makeStream({
        provider: ID, label: LABEL, url: ep.link, title: basename(ep.link),
        quality: detectQuality(ep.link + ' ' + extra), headers: STREAM_HEADERS,
      }));
    }
  });
  return streams;
}

export const getStreams = createProvider(ID, run);
