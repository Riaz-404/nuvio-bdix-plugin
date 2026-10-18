// Dflix / Discovery FTP (BDIX)
// Port of the Dflix providers in niloy-cloudstream (dflix.discoveryftp.net, demo login)
// and Redowan-CloudStream (movies.discoveryftp.net, no login).
import { request, getText, formBody, readCookies, absUrl, mapLimit } from '../common/http.js';
import { loadHtml, all, text } from '../common/dom.js';
import {
  scoreCandidate, extractYear, parseSeasonNumber, parseSE, episodeMatches, isVideoFile, basename, detectQuality,
} from '../common/match.js';
import { makeStream, createProvider } from '../common/stream.js';

const ID = 'dflix';
const LABEL = 'BDIX | Dflix';
const HOSTS = [
  { base: 'https://dflix.discoveryftp.net', login: true },
  { base: 'https://movies.discoveryftp.net', login: false },
];

async function openSession(host, isTv) {
  let cookie = '';
  if (host.login) {
    const res = await request(host.base + '/login/demo', { redirect: 'manual', timeout: 10000 });
    if (!res) return null; // host unreachable from this network
    cookie = readCookies(res);
  }
  const headers = { Referer: host.base + (isTv ? '/s' : '/m') };
  if (cookie) headers.Cookie = cookie;
  return { host, headers };
}

function fetchPage(session, url, opts = {}) {
  return getText(url, { timeout: 20000, ...opts, headers: { ...session.headers, ...(opts.headers || {}) } });
}

// Search result rows -> [{ url, title, year }]
function parseResults($, base) {
  const out = [];
  for (const row of all($, 'div.moviesearchiteam')) {
    const a = row.find('a').first();
    const href = a.attr('href') || row.attr('href');
    if (!href) continue;
    const details = text(row.find('.searchdetails'));
    const y = details.match(/Year\s*:?\s*((?:19|20)\d\d)/i);
    out.push({ url: absUrl(href, base + '/'), title: text(row.find('.searchtitle')), year: y ? +y[1] : extractYear(details) });
  }
  if (out.length) return out;
  for (const card of all($, 'div.card')) {
    if (card.find('.poster.disable').length) continue;
    const href = card.find('a').first().attr('href');
    const title = text(card.find('h3').first());
    if (!href || !title) continue;
    out.push({ url: absUrl(href, base + '/'), title, year: extractYear(text(card)) });
  }
  return out;
}

async function search(session, info) {
  const base = session.host.base;
  const found = new Map();
  for (const q of info.queries) {
    const html = info.isTv
      ? await fetchPage(session, base + '/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody({ term: q, types: 's' }),
        })
      : await fetchPage(session, base + '/m/find/' + encodeURIComponent(q));
    if (html == null) return null;
    for (const r of parseResults(loadHtml(html), base)) if (!found.has(r.url)) found.set(r.url, r);
    if (found.size) break;
  }
  return [...found.values()]
    .map((r) => ({ r, s: scoreCandidate(r, info) }))
    .filter((x) => x.s >= 0.8)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.r);
}

function videoLinks($, pageUrl) {
  const links = all($, 'a[href]')
    .map((a) => absUrl(a.attr('href'), pageUrl))
    .filter((u) => /^https?:/.test(u) && isVideoFile(u));
  if (!links.length) {
    // original layout: main download button
    const main = $('div.col-md-12:nth-child(3) > div:nth-child(1) > a:nth-child(1)').attr('href');
    if (main && /^https?:/.test(main)) links.push(main);
  }
  return links;
}

async function movieStreams(session, result) {
  const html = await fetchPage(session, result.url);
  if (!html) return [];
  const $ = loadHtml(html);
  const title = text($('.movie-detail-content h3').first()) || result.title;
  const size = text($('.badge.badge-fill').first());
  const urls = videoLinks($, result.url);

  // other quality versions are separate movie pages
  const variants = all($, 'div.badge-outline a')
    .map((a) => absUrl(a.attr('href'), result.url))
    .filter((u) => u && u !== result.url)
    .slice(0, 3);
  const extra = await mapLimit(variants, 3, async (u) => {
    const h = await fetchPage(session, u);
    return h ? videoLinks(loadHtml(h), u) : [];
  });

  return [...urls, ...extra.flat()].map((url, i) =>
    makeStream({
      provider: ID,
      label: LABEL,
      url,
      title: basename(url) || title,
      quality: detectQuality(url + ' ' + title),
      size: i < urls.length && /\d\s*[KMGT]B/i.test(size) ? size : undefined,
    })
  );
}

async function episodeStreams(session, result, season, episode) {
  const html = await fetchPage(session, result.url);
  if (!html) return [];
  const $ = loadHtml(html);
  // newest season is listed first
  const seasons = all($, 'table.table tbody tr a')
    .map((a) => ({ name: text(a), url: absUrl(a.attr('href'), result.url) }))
    .filter((s) => s.url)
    .reverse();
  let target = seasons.filter((s) => parseSeasonNumber(s.name) === season);
  if (!target.length && seasons[season - 1] && seasons.every((s) => parseSeasonNumber(s.name) == null)) target = [seasons[season - 1]];

  const streams = [];
  for (const s of target.slice(0, 2)) {
    const sh = await fetchPage(session, s.url);
    if (!sh) continue;
    const $s = loadHtml(sh);
    let cards = all($s, 'div.card');
    if (!cards.length) cards = all($s, "div[style*='background-image']");
    const eps = cards
      .map((c) => {
        const link = c.find('h5 a').first().attr('href') || c.find('a.btn').first().attr('href');
        const name = text(c.find('h4').first()) || text(c.find('h5').first());
        return link ? { url: absUrl(link, s.url), name } : null;
      })
      .filter(Boolean);
    let hits = eps.filter((e) => episodeMatches(e.name + ' ' + basename(e.url), season, episode));
    if (!hits.length && eps[episode - 1] && eps.every((e) => !parseSE(e.name + ' ' + basename(e.url)))) hits = [eps[episode - 1]];
    for (const e of hits) {
      streams.push(makeStream({ provider: ID, label: LABEL, url: e.url, title: basename(e.url) || e.name }));
    }
  }
  return streams;
}

async function run(info, season, episode) {
  for (const host of HOSTS) {
    const session = await openSession(host, info.isTv);
    if (!session) continue;
    const results = await search(session, info);
    if (results == null) continue; // unreachable; try the next host
    const lists = await mapLimit(results, 3, (r) =>
      info.isTv ? episodeStreams(session, r, season, episode) : movieStreams(session, r)
    );
    const streams = lists.flat().filter(Boolean);
    if (streams.length) return streams;
  }
  return [];
}

export const getStreams = createProvider(ID, run);
