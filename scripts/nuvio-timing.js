// Runs a built provider under Nuvio's timing rules and reports when Nuvio would actually
// receive the result. In Nuvio (QuickJS via quickjs-kt):
//   - setTimeout is a native sleep; clearTimeout only stops the callback, the sleep keeps running
//   - fetch ignores AbortSignal
//   - the plugin call returns only after every pending async job (timers, requests) finished
// So a scraper that resolves in 1 s but leaves a 50 s timer behind is a 50 s scraper in the app.
//
// usage: node scripts/nuvio-timing.js <id> <tmdbId> movie|tv [season] [episode]
//        node scripts/nuvio-timing.js --all      (every scraper, Inception + GoT S01E01)
// Exits 1 if any run keeps Nuvio waiting more than 1 s after getStreams resolved.
//
// Unreachable servers show Node's ~10 s connect timeout here; on Android, Nuvio's HTTP
// client waits up to 60 s, which hits the 60 s plugin limit.
const fs = require('fs');
const path = require('path');

const SLACK_MS = 1000;

const quietConsole = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

function runInNuvioScope(id) {
  const pending = new Set();
  const track = (p) => {
    pending.add(p);
    p.then(() => pending.delete(p), () => pending.delete(p));
    return p;
  };
  const timers = {};
  let nextId = 0;
  const nSetTimeout = (cb, ms, ...args) => {
    const tid = ++nextId;
    timers[tid] = true;
    track(new Promise((r) => setTimeout(r, ms || 0))).then(() => {
      if (!timers[tid]) return;
      delete timers[tid];
      cb(...args);
    });
    return tid;
  };
  const nClearTimeout = (tid) => {
    delete timers[tid];
  };
  // Nuvio returns status 0 on network errors instead of throwing, and ignores `signal`
  const nFetch = (url, opts = {}) => {
    const { signal, ...rest } = opts;
    return track(
      fetch(url, rest).catch(() => ({ ok: false, status: 0, url, headers: new Headers(), text: async () => '' }))
    );
  };
  const nRequire = (name) => require(name === 'cheerio-without-node-native' ? 'cheerio' : name);

  const code = fs.readFileSync(path.join(__dirname, '..', 'providers', id + '.js'), 'utf8');
  const module = { exports: {} };
  // Same shape as Nuvio's wrapper; __native_fetch marks the scope as Nuvio for http.js
  globalThis.__native_fetch = () => {};
  try {
    new Function('module', 'exports', 'require', 'setTimeout', 'clearTimeout', 'fetch', 'console', code)(
      module, module.exports, nRequire, nSetTimeout, nClearTimeout, nFetch, quietConsole
    );
  } finally {
    delete globalThis.__native_fetch;
  }
  return { getStreams: module.exports.getStreams, pending };
}

async function measure(id, tmdbId, type, season, episode) {
  const { getStreams, pending } = runInNuvioScope(id);
  const t0 = Date.now();
  const streams = await getStreams(String(tmdbId), type, season, episode);
  const resolvedMs = Date.now() - t0;
  while (pending.size) await Promise.race([...pending]);
  const returnedMs = Date.now() - t0;
  const lingerMs = returnedMs - resolvedMs;
  const ok = lingerMs <= SLACK_MS;
  const what = type === 'tv' ? `${tmdbId} S${season}E${episode}` : `${tmdbId} movie`;
  console.log(
    `${ok ? 'ok  ' : 'SLOW'} ${id.padEnd(10)} ${what.padEnd(16)} ${String(streams.length).padStart(2)} streams | ` +
      `resolved ${(resolvedMs / 1000).toFixed(1)}s | Nuvio gets it at ${(returnedMs / 1000).toFixed(1)}s`
  );
  return ok;
}

(async () => {
  const args = process.argv.slice(2);
  const runs = [];
  if (args[0] === '--all') {
    const ids = fs.readdirSync(path.join(__dirname, '..', 'providers')).map((f) => f.replace(/\.js$/, ''));
    for (const id of ids) runs.push([id, '27205', 'movie'], [id, '1399', 'tv', 1, 1]);
  } else if (args.length >= 2) {
    const [id, tmdbId, type = 'movie', s, e] = args;
    runs.push([id, tmdbId, type, s ? Number(s) : undefined, e ? Number(e) : undefined]);
  } else {
    console.log('usage: node scripts/nuvio-timing.js <id> <tmdbId> movie|tv [season] [episode]\n       node scripts/nuvio-timing.js --all');
    process.exit(1);
  }
  const results = await Promise.all(runs.map((r) => measure(...r)));
  process.exit(results.every(Boolean) ? 0 : 1);
})();
