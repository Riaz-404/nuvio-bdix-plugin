// Offline tests for scrapers whose servers are only reachable from certain BDIX ISPs.
// A fake fetch serves responses shaped like each server's real API/HTML (taken from the
// original CloudStream extensions), so search, matching and link building are exercised.
// usage: node scripts/mock-test.js
const Module = require('module');
const path = require('path');
const assert = require('assert');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'cheerio-without-node-native') request = 'cheerio';
  return origResolve.call(this, request, ...rest);
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s) => new Response(s, { status: 200, headers: { 'content-type': 'text/html' } });

const TMDB = {
  'movie/27205': { title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', external_ids: { imdb_id: 'tt1375666' } },
  'movie/634649': { title: 'Spider-Man: No Way Home', original_title: 'Spider-Man: No Way Home', release_date: '2021-12-15', external_ids: { imdb_id: 'tt10872600' } },
  'tv/1399': { name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', external_ids: { imdb_id: 'tt0944947' } },
};

let routes = [];
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? String(opts.body) : '';
  calls.push(method + ' ' + url);
  const t = url.match(/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)/);
  if (t) return TMDB[t[1] + '/' + t[2]] ? json(TMDB[t[1] + '/' + t[2]]) : json({ success: false }, 404);
  for (const r of routes) {
    if (r.method && r.method !== method) continue;
    if (!r.match(url, body, opts)) continue;
    return r.reply(url, body, opts);
  }
  throw new TypeError('fetch failed (unreachable in mock): ' + method + ' ' + url);
};

function load(id) {
  const file = path.join(__dirname, '..', 'providers', id + '.js');
  delete require.cache[file];
  return require(file);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- DhakaFlix (h5ai)
const DF12 = '/DHAKA-FLIX-12/TV-WEB-Series/TV%20Series%20%E2%99%A5%20%20A%20%20%E2%80%94%20%20L/Game%20of%20Thrones%20%28TV%20Series%202011%E2%80%932019%29%201080p/';
const DF7 = '/DHAKA-FLIX-7/English%20Movies/%282010%29/Inception%20%282010%29%201080p%20BluRay/';
const DF14 = '/DHAKA-FLIX-14/English%20Movies%20%281080p%29/%282021%29%201080p/Spider-Man%20No%20Way%20Home%20%282021%29%201080p%20WEB-DL/';
function h5aiRoutes() {
  return [
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.7/DHAKA-FLIX-7/' && b.includes('"search"'),
      reply: (u, b) => {
        const pattern = JSON.parse(b).search.pattern;
        assert.ok(/inception/i.test(pattern), 'h5ai pattern ' + pattern);
        return json({ search: [
          { href: DF7, size: null, time: 1 },
          { href: '/DHAKA-FLIX-7/English%20Movies/%282010%29/Inception%20Of%20Fear%20%282012%29/', size: null },
        ] });
      },
    },
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.7' + DF7 && b.includes('"items"'),
      reply: () => json({ items: [
        { href: '/DHAKA-FLIX-7/', size: null },
        { href: DF7, size: null },
        { href: DF7 + 'Inception.2010.1080p.BluRay.x264.mkv', size: 2147483648 },
        { href: DF7 + 'poster.jpg', size: 1000 },
      ] }),
    },
    // server 14 returns search hits but only serves the HTML listing (items API disabled)
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.14/DHAKA-FLIX-14/' && b.includes('"search"'),
      reply: (u, b) => {
        const pattern = JSON.parse(b).search.pattern;
        const re = new RegExp(pattern, 'i');
        const name = 'Spider-Man No Way Home (2021) 1080p WEB-DL';
        return json({ search: re.test(name) ? [{ href: DF14, size: null }] : [] });
      },
    },
    { method: 'POST', match: (u, b) => u === 'http://172.16.50.14' + DF14, reply: () => json({ code: 1 }) },
    {
      method: 'GET',
      match: (u) => u === 'http://172.16.50.14' + DF14,
      reply: () => html(`<table><tbody>
        <tr><th></th><th>Name</th></tr>
        <tr><td class="fb-i"><img src="/_h5ai/folder.png" alt="folder"></td><td class="fb-n"><a href="/DHAKA-FLIX-14/English%20Movies%20%281080p%29/%282021%29%201080p/">Parent Directory</a></td></tr>
        <tr><td class="fb-i"><img alt="file"></td><td class="fb-n"><a href="${DF14}Spider-Man.No.Way.Home.2021.1080p.WEB-DL.mkv">Spider-Man.No.Way.Home.2021.1080p.WEB-DL.mkv</a></td><td class="fb-d">2022-01-01</td><td class="fb-s">2.4 GB</td></tr>
      </tbody></table>`),
    },
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.12/DHAKA-FLIX-12/' && b.includes('"search"'),
      reply: () => json({ search: [
        { href: DF12, size: null },
        { href: DF12 + 'Season%202/', size: null },
      ] }),
    },
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.12' + DF12 && b.includes('"items"'),
      reply: () => json({ items: [
        { href: DF12, size: null },
        { href: DF12 + 'Season%201/', size: null },
        { href: DF12 + 'Season%202/', size: null },
        { href: DF12 + 'poster.jpg', size: 10 },
      ] }),
    },
    {
      method: 'POST',
      match: (u, b) => u === 'http://172.16.50.12' + DF12 + 'Season%202/' && b.includes('"items"'),
      reply: () => json({ items: [
        { href: DF12 + 'Season%202/', size: null },
        { href: DF12 + 'Season%202/Game.of.Thrones.S02E02.1080p.mkv', size: 1e9 },
        { href: DF12 + 'Season%202/Game.of.Thrones.S02E03.1080p.mkv', size: 1e9 },
      ] }),
    },
  ];
}

test('dhakaflix movie (items API)', async () => {
  routes = h5aiRoutes();
  const s = await load('dhakaflix').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.strictEqual(s[0].url, 'http://172.16.50.7' + DF7 + 'Inception.2010.1080p.BluRay.x264.mkv');
  assert.strictEqual(s[0].quality, '1080p');
  assert.strictEqual(s[0].size, '2.00 GB');
  assert.strictEqual(s[0].name, 'BDIX | DhakaFlix 7');
});

test('dhakaflix movie with punctuation (regex pattern + HTML listing fallback)', async () => {
  routes = h5aiRoutes();
  const s = await load('dhakaflix').getStreams('634649', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Spider-Man.No.Way.Home.2021.1080p.WEB-DL.mkv'));
  assert.strictEqual(s[0].size, '2.4 GB');
});

test('dhakaflix episode', async () => {
  routes = h5aiRoutes();
  const s = await load('dhakaflix').getStreams('1399', 'tv', 2, 3);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Season%202/Game.of.Thrones.S02E03.1080p.mkv'));
});

// ---------------------------------------------------------------- Emby (FTPBD / RoarZone)
function embyRoutes(base, { honorProviderIds }) {
  const items = [
    { Id: 'm1', Name: 'Inception', ProductionYear: 2010, Type: 'Movie', ProviderIds: { Tmdb: '27205', Imdb: 'tt1375666' },
      MediaSources: [{ Id: 'ms1', Container: 'mkv', Size: 3221225472, Path: '/data/Movies/Inception (2010)/Inception.2010.1080p.mkv', MediaStreams: [{ Type: 'Video', Height: 1080 }] }] },
    { Id: 'm2', Name: 'Inception', ProductionYear: 2014, Type: 'Movie', ProviderIds: { Tmdb: '999' }, MediaSources: [{ Id: 'x' }] },
    { Id: 's1', Name: 'Game of Thrones', ProductionYear: 2011, Type: 'Series', ProviderIds: { Tmdb: '1399' } },
  ];
  return [
    {
      method: 'POST',
      match: (u) => u === base + '/emby/Users/AuthenticateByName',
      reply: (u, b, o) => {
        assert.ok(o.headers['X-Emby-Authorization'].startsWith('MediaBrowser Client='));
        return json({ AccessToken: 'tok123', User: { Id: 'u1' } });
      },
    },
    {
      method: 'GET',
      match: (u) => u.startsWith(base + '/emby/Users/u1/Items?'),
      reply: (u) => {
        const q = new URL(u).searchParams;
        assert.strictEqual(q.get('api_key'), 'tok123');
        const type = q.get('IncludeItemTypes');
        let list = items.filter((i) => i.Type === type);
        if (q.get('AnyProviderIdEquals') && honorProviderIds) {
          const ids = q.get('AnyProviderIdEquals').split(',');
          list = list.filter((i) => ids.includes('tmdb.' + i.ProviderIds.Tmdb));
        } else if (q.get('searchTerm')) {
          list = list.filter((i) => i.Name.toLowerCase().includes(q.get('searchTerm').toLowerCase()));
        }
        return json({ Items: list, TotalRecordCount: list.length });
      },
    },
    {
      method: 'GET',
      match: (u) => u.startsWith(base + '/emby/Shows/s1/Episodes?'),
      reply: () => json({ Items: [
        { Id: 'e22', ParentIndexNumber: 2, IndexNumber: 2, MediaSources: [{ Id: 'e22', Container: 'mkv', Path: '/tv/GoT/S02/Game.of.Thrones.S02E02.mkv', MediaStreams: [{ Type: 'Video', Height: 720 }] }] },
        { Id: 'e23', ParentIndexNumber: 2, IndexNumber: 3, MediaSources: [{ Id: 'e23', Container: 'mkv', Size: 1e9, Path: '/tv/GoT/S02/Game.of.Thrones.S02E03.mkv', MediaStreams: [{ Type: 'Video', Height: 720 }] }] },
      ] }),
    },
  ];
}

test('ftpbd movie via AnyProviderIdEquals', async () => {
  const base = 'http://media.ftpbd.net:8096';
  routes = embyRoutes(base, { honorProviderIds: true });
  const s = await load('ftpbd').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.strictEqual(s[0].url, base + '/emby/Videos/m1/stream.mkv?Static=true&MediaSourceId=ms1&api_key=tok123');
  assert.strictEqual(s[0].quality, '1080p');
  assert.strictEqual(s[0].title, 'Inception.2010.1080p.mkv');
  assert.strictEqual(s[0].size, '3.00 GB');
});

test('roarzone movie when server ignores AnyProviderIdEquals', async () => {
  const base = 'https://play.roarzone.info';
  routes = embyRoutes(base, { honorProviderIds: false });
  const s = await load('roarzone').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s)); // the 2014 "Inception" with another tmdb id is excluded
  assert.ok(s[0].url.includes('/Videos/m1/'));
});

test('ftpbd episode', async () => {
  routes = embyRoutes('http://media.ftpbd.net:8096', { honorProviderIds: true });
  const s = await load('ftpbd').getStreams('1399', 'tv', 2, 3);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.includes('/Videos/e23/stream.mkv'));
  assert.strictEqual(s[0].quality, '720p');
});

// ---------------------------------------------------------------- FMFTP
function fmftpRoutes() {
  return [
    {
      method: 'GET',
      match: (u) => u.startsWith('https://fmftp.net/api/search?'),
      reply: () => json([
        { id: 11, title: 'Inception', year: 2010, type: 'movie', tmdb_id: '27205', Library: { type: 'MOVIE' } },
        { id: 12, title: 'Inception', year: 2010, type: 'movie', tmdb_id: '64956' },
        { id: 21, title: 'Game of Thrones', year: 2011, type: 'tv', tmdb_id: '1399', Library: { type: 'TV' } },
      ]),
    },
    {
      method: 'GET',
      match: (u) => u === 'https://fmftp.net/api/tv-shows/21?fields=episodes',
      reply: () => json({ id: 21, episodes: [
        { id: 501, season_number: 2, episode_number: 3, name: 'What Is Dead May Never Die' },
        { id: 502, season_number: 2, episode_number: 4 },
      ] }),
    },
    {
      method: 'HEAD',
      match: (u) => u.startsWith('https://fmftp.net/api/stream/video/stream?'),
      reply: (u) => {
        const q = new URL(u).searchParams;
        const file = q.get('type') === 'movies' ? '/Movies/Inception.2010.1080p.BluRay.mkv' : '/TV/GoT/Game.of.Thrones.S02E03.720p.mkv';
        return new Response(null, { status: 302, headers: { location: 'http://103.179.128.246' + file } });
      },
    },
  ];
}

test('fmftp movie (tmdb_id match + 302 resolve)', async () => {
  routes = fmftpRoutes();
  const s = await load('fmftp').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.strictEqual(s[0].url, 'http://103.179.128.246/Movies/Inception.2010.1080p.BluRay.mkv');
  assert.strictEqual(s[0].quality, '1080p');
});

test('fmftp episode', async () => {
  routes = fmftpRoutes();
  const s = await load('fmftp').getStreams('1399', 'tv', 2, 3);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Game.of.Thrones.S02E03.720p.mkv'));
});

// ---------------------------------------------------------------- Dflix
function dflixRoutes() {
  const B = 'https://dflix.discoveryftp.net';
  return [
    {
      method: 'GET',
      match: (u) => u === B + '/login/demo',
      reply: (u, b, o) => {
        assert.strictEqual(o.redirect, 'manual');
        const h = new Headers();
        h.append('set-cookie', 'XSRF-TOKEN=abc; path=/');
        h.append('set-cookie', 'dflix_session=xyz; path=/; httponly');
        h.append('location', B + '/');
        return new Response(null, { status: 302, headers: h });
      },
    },
    {
      method: 'GET',
      match: (u) => u.startsWith(B + '/m/find/'),
      reply: (u, b, o) => {
        assert.ok(o.headers.Cookie.includes('dflix_session=xyz'), 'cookie sent');
        return html(`<div class="moviesearchiteam ps-1 mb-1"><a href="/m/view/31001"><div class="searchtitle">Inception</div><div class="searchdetails">Year : 2010 Category:English Quality: 1080P BluRay</div></a></div>
          <div class="moviesearchiteam ps-1 mb-1"><a href="/m/view/31002"><div class="searchtitle">Inception</div><div class="searchdetails">Year : 2017 Category:Hindi</div></a></div>`);
      },
    },
    {
      method: 'GET',
      match: (u) => u === B + '/m/view/31001',
      reply: () => html(`<div class="movie-detail-content"><h3>Inception</h3><span class="badge badge-fill">2.1 GB</span></div>
        <div class="col-md-12"><div><a href="http://cds1.discoveryftp.net/Movies/English/2010/Inception%20%282010%29/Inception.2010.1080p.BluRay.mkv">Download</a></div></div>
        <div class="badge-outline"><a href="/m/view/31003">720p</a></div>`),
    },
    {
      method: 'GET',
      match: (u) => u === B + '/m/view/31003',
      reply: () => html(`<div class="col-md-12"><div><a href="http://cds1.discoveryftp.net/Movies/English/2010/Inception%20720p/Inception.2010.720p.mkv">Download</a></div></div>`),
    },
    {
      method: 'POST',
      match: (u, b) => u === B + '/search' && b.includes('types=s'),
      reply: () => html(`<div class="moviesearchiteam"><a href="/s/view/777"><div class="searchtitle">Game of Thrones</div><div class="searchdetails">Year : 2011</div></a></div>`),
    },
    {
      method: 'GET',
      match: (u) => u === B + '/s/view/777',
      reply: () => html(`<div class="movie-detail-content-test"><h3>Game of Thrones</h3></div>
        <table class="table mb-0"><tbody>
          <tr><th><a href="/s/view/777/season/3">Season 3</a></th></tr>
          <tr><th><a href="/s/view/777/season/2">Season 2</a></th></tr>
          <tr><th><a href="/s/view/777/season/1">Season 1</a></th></tr>
        </tbody></table>`),
    },
    {
      method: 'GET',
      match: (u) => u === B + '/s/view/777/season/2',
      reply: () => html(`
        <div class="card p-4"><h4>Episode 2 <span>The Night Lands</span></h4><div class="mt-2"><h5><a href="http://cds2.discoveryftp.net/TV/GoT/S02/Game.of.Thrones.S02E02.720p.mkv">Download</a></h5></div></div>
        <div class="card p-4"><h4>Episode 3 <span>What Is Dead May Never Die</span></h4><div class="mt-2"><h5><a href="http://cds2.discoveryftp.net/TV/GoT/S02/Game.of.Thrones.S02E03.720p.mkv">Download</a></h5></div></div>`),
    },
  ];
}

test('dflix movie (login cookie, year filter, quality variant)', async () => {
  routes = dflixRoutes();
  const s = await load('dflix').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 2, JSON.stringify(s));
  assert.strictEqual(s[0].url, 'http://cds1.discoveryftp.net/Movies/English/2010/Inception%20%282010%29/Inception.2010.1080p.BluRay.mkv');
  assert.strictEqual(s[0].size, '2.1 GB');
  assert.strictEqual(s[1].quality, '720p');
  assert.ok(!calls.some((c) => c.includes('/m/view/31002')), 'wrong-year result skipped');
});

test('dflix episode', async () => {
  routes = dflixRoutes();
  const s = await load('dflix').getStreams('1399', 'tv', 2, 3);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Game.of.Thrones.S02E03.720p.mkv'));
});

// ---------------------------------------------------------------- ICC FTP
function iccRoutes() {
  const B = 'http://10.16.100.244/';
  return [
    {
      method: 'POST',
      match: (u, b) => u === B + 'command.php' && b.startsWith('cSearch='),
      reply: () => json([
        { id: '367', image: 'inception.jpg', name: 'Inception', type: '1' },
        { id: '900', image: 'got.jpg', name: 'Game of Thrones', type: '2' },
      ]),
    },
    {
      method: 'GET',
      match: (u) => u === B + 'player.php?play=367',
      reply: () => html(`<table class="table"><tbody>
        <tr><td colspan="2">Inception</td></tr><tr><td>Year</td><td>2010</td></tr></tbody></table>
        <a class="btn btn-success" href="http://10.16.100.250/Movies/Inception%20(2010)/Inception.2010.720p.mkv">Download</a>`),
    },
    {
      method: 'GET',
      match: (u) => u === B + 'player.php?play=900',
      reply: () => html(`<table class="table"><tbody><tr><td>Game of Thrones</td></tr><tr><td>Year</td><td>2011</td></tr></tbody></table>
        <div class="btn-group"><button>Episodes</button><ul class="dropdown-menu">
          <li><a href="http://10.16.100.250/TV/GoT/S02/Game.of.Thrones.S02E02.mkv">S02E02 <span>1.1 GB</span></a></li>
          <li><a href="http://10.16.100.250/TV/GoT/S02/Game.of.Thrones.S02E03.mkv">S02E03 <span>1.2 GB</span></a></li>
        </ul></div>`),
    },
  ];
}

test('iccftp movie', async () => {
  routes = iccRoutes();
  const s = await load('iccftp').getStreams('27205', 'movie');
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Inception.2010.720p.mkv'));
});

test('iccftp episode', async () => {
  routes = iccRoutes();
  const s = await load('iccftp').getStreams('1399', 'tv', 2, 3);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.ok(s[0].url.endsWith('Game.of.Thrones.S02E03.mkv'));
});

// ---------------------------------------------------------------- unreachable servers
test('all scrapers return [] when their servers are unreachable', async () => {
  routes = [];
  for (const id of ['dhakaflix', 'dflix', 'ftpbd', 'roarzone', 'fmftp', 'iccftp', 'circleftp', 'ctgmovies']) {
    const s = await load(id).getStreams('27205', 'movie');
    assert.deepStrictEqual(s, [], id);
  }
});

(async () => {
  const realLog = console.log;
  let failed = 0;
  for (const t of tests) {
    calls.length = 0;
    console.log = () => {};
    try {
      await t.fn();
      console.log = realLog;
      console.log('ok   ' + t.name);
    } catch (e) {
      console.log = realLog;
      failed++;
      console.log('FAIL ' + t.name + '\n     ' + (e && e.message));
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
