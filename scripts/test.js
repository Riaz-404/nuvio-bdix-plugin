// Runs a built provider the way Nuvio does.
// usage: node scripts/test.js <id> <tmdbId> movie|tv [season] [episode] [--check]
const Module = require('module');
const path = require('path');

// Nuvio exposes cheerio under this name; map it to the real package in Node.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'cheerio-without-node-native') request = 'cheerio';
  return origResolve.call(this, request, ...rest);
};

if (process.env.TMDB_API_KEY) globalThis.TMDB_API_KEY = process.env.TMDB_API_KEY;

async function checkUrl(s) {
  try {
    const res = await fetch(s.url, { headers: { ...(s.headers || {}), Range: 'bytes=0-1' }, redirect: 'follow' });
    try { await res.body?.cancel(); } catch (e) {}
    return res.status + ' ' + (res.headers.get('content-type') || '');
  } catch (e) {
    return 'ERR ' + e.message;
  }
}

(async () => {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const [id, tmdbId, type = 'movie', season, episode] = args.filter((a) => a !== '--check');
  if (!id || !tmdbId) {
    console.log('usage: node scripts/test.js <id> <tmdbId> movie|tv [season] [episode] [--check]');
    process.exit(1);
  }
  const mod = require(path.join(__dirname, '..', 'providers', id + '.js'));
  const t0 = Date.now();
  const streams = await mod.getStreams(String(tmdbId), type, season ? Number(season) : undefined, episode ? Number(episode) : undefined);
  console.log(`\n${streams.length} streams in ${Date.now() - t0}ms`);
  for (const s of streams) {
    console.log(`- [${s.quality}] ${s.name} | ${s.title}${s.size ? ' | ' + s.size : ''}\n  ${s.url}`);
    if (check) console.log('  -> ' + (await checkUrl(s)));
  }
})();
