// Shared Emby client for the BDIX Emby servers (FTPBD, RoarZone).
import { getJson, postJson } from './http.js';
import { titleScore, scoreCandidate, qualityFromHeight, detectQuality } from './match.js';
import { makeStream } from './stream.js';

const CLIENT = 'MediaBrowser Client="Nuvio", Device="Android", DeviceId="nuvio-bdix-plugin", Version="1.0.0"';
const FIELDS = 'ProviderIds,ProductionYear,MediaSources,Path';

export function createEmby({ id, label, base, username, password }) {
  let session = null; // { token, userId }, set by login()

  function authHeader() {
    return { 'X-Emby-Authorization': CLIENT + (session ? ', Token="' + session.token + '"' : '') };
  }

  async function login() {
    if (session) return session;
    const d = await postJson(
      base + '/emby/Users/AuthenticateByName',
      { Username: username, Password: password, Pw: password },
      { headers: authHeader(), timeout: 12000 }
    );
    if (d && d.AccessToken && d.User && d.User.Id) session = { token: d.AccessToken, userId: d.User.Id };
    return session;
  }

  function get(path) {
    const sep = path.includes('?') ? '&' : '?';
    return getJson(base + path + sep + 'api_key=' + encodeURIComponent(session.token), {
      headers: authHeader(),
      timeout: 15000,
    });
  }

  async function findItems(info) {
    const type = info.isTv ? 'Series' : 'Movie';
    const userItems = '/emby/Users/' + session.userId + '/Items?Recursive=true&IncludeItemTypes=' + type + '&Fields=' + FIELDS;

    // 1) exact provider-id lookup
    const ids = ['tmdb.' + info.tmdbId];
    if (info.imdbId) ids.push('imdb.' + info.imdbId);
    // Limit guards servers that ignore AnyProviderIdEquals and would return the whole library
    const exact = await get(userItems + '&Limit=20&AnyProviderIdEquals=' + encodeURIComponent(ids.join(',')));
    const exactItems = ((exact && exact.Items) || []).filter((it) => providerMatch(it, info));
    if (exactItems.length) return exactItems;

    // 2) title search, then prefer provider-id match, then title + year
    const found = new Map();
    for (const q of info.queries) {
      const res = await get(userItems + '&Limit=50&searchTerm=' + encodeURIComponent(q));
      if (res == null) break;
      for (const it of (res && res.Items) || []) found.set(it.Id, it);
      if (found.size) break;
    }
    const items = [...found.values()];
    const byId = items.filter((it) => providerMatch(it, info));
    if (byId.length) return byId;
    return items
      .filter((it) => !hasOtherTmdb(it, info))
      .map((it) => ({ it, s: scoreCandidate({ title: it.Name, year: it.ProductionYear }, info) }))
      .filter((x) => x.s >= 0.85 || titleScore(x.it.OriginalTitle || '', info.titles) >= 0.95)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.it);
  }

  function providerMatch(it, info) {
    const p = it.ProviderIds || {};
    const tmdb = p.Tmdb || p.tmdb;
    const imdb = p.Imdb || p.imdb;
    return (tmdb && String(tmdb) === String(info.tmdbId)) || (imdb && info.imdbId && imdb === info.imdbId);
  }

  function hasOtherTmdb(it, info) {
    const p = it.ProviderIds || {};
    const tmdb = p.Tmdb || p.tmdb;
    return tmdb && String(tmdb) !== String(info.tmdbId);
  }

  async function episodesFor(series, season, episode) {
    const res = await get(
      '/emby/Shows/' + series.Id + '/Episodes?UserId=' + session.userId + '&Season=' + season + '&Fields=' + FIELDS
    );
    return ((res && res.Items) || []).filter(
      (ep) =>
        Number(ep.ParentIndexNumber) === season &&
        (Number(ep.IndexNumber) === episode ||
          (ep.IndexNumberEnd && episode >= ep.IndexNumber && episode <= ep.IndexNumberEnd))
    );
  }

  function streamsForItem(item) {
    const sources = item.MediaSources && item.MediaSources.length ? item.MediaSources : [{ Id: item.Id }];
    return sources.map((src) => {
      const video = (src.MediaStreams || []).find((m) => m.Type === 'Video') || {};
      const container = (src.Container || '').split(',')[0];
      const url =
        base + '/emby/Videos/' + item.Id + '/stream' + (container ? '.' + container : '') +
        '?Static=true&MediaSourceId=' + encodeURIComponent(src.Id || item.Id) +
        '&api_key=' + encodeURIComponent(session.token);
      const fileName = (src.Path || item.Path || '').split(/[\\/]/).pop() || src.Name || item.Name;
      return makeStream({
        provider: id,
        label,
        url,
        title: fileName,
        quality: video.Height ? qualityFromHeight(video.Height) : detectQuality(fileName),
        size: src.Size || undefined,
      });
    });
  }

  return async function run(info, season, episode) {
    session = null; // fresh token per request; guest tokens can be revoked server-side
    if (!(await login())) return [];
    const items = await findItems(info);
    if (!info.isTv) return items.flatMap(streamsForItem);
    const eps = [];
    for (const series of items) eps.push(...(await episodesFor(series, season, episode)));
    return eps.flatMap(streamsForItem);
  };
}
