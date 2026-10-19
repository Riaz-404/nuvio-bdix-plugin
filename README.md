# BDIX Repo for Nuvio

A plugin repository for the [Nuvio](https://github.com/NuvioMedia/NuvioMobile) media app that streams movies and TV episodes from Bangladeshi **BDIX** servers.

BDIX servers are FTP and media servers hosted inside Bangladesh's local internet exchange. They are fast and free, but you can only reach them from ISPs connected to that exchange. Each server works with a different set of ISPs.

---

## Contents

- [Install in Nuvio](#install-in-nuvio)
- [Supported sources](#supported-sources)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Development](#development)
- [Adding a new source](#adding-a-new-source)
- [Nuvio runtime constraints](#nuvio-runtime-constraints)
- [Contributing](#contributing)
- [Credits and disclaimer](#credits-and-disclaimer)

---

## Install in Nuvio

1. Open Nuvio and go to **Settings → Content & Discovery → Plugins → Add repository**.
2. Paste the repository URL:
   ```
   https://raw.githubusercontent.com/Riaz-404/nuvio-bdix-plugin/main
   ```
   Nuvio appends `/manifest.json` itself, so don't add it.
3. Enable the sources your ISP can reach and **disable the rest**. A source whose server your ISP can't reach keeps the stream list loading for up to a minute on every title (see [Loading is slow](#loading-is-slow-or-a-source-never-returns-anything)).

When you open a movie or episode, results from these sources appear in Nuvio's stream list, labelled `BDIX | <source>`.

> Only Nuvio's GitHub (sideloaded) builds support plugins. The Play Store and App Store builds do not.

---

## Supported sources

| Scraper id | Source | Content | How a title is matched |
|---|---|---|---|
| `circleftp` | Circle FTP: API at `new.circleftp.net:5000` | Movies, series, anime | Title + year |
| `dhakaflix` | DhakaFlix: h5ai servers at `172.16.50.7`, `.9`, `.12`, `.14` | Movies, series, anime, Korean | Title + year |
| `dflix` | Discovery FTP: `dflix.discoveryftp.net`, falling back to `movies.discoveryftp.net` | Movies, series | Title + year |
| `ftpbd` | FTPBD: Emby server at `media.ftpbd.net:8096` (public guest account) | Movies, series | TMDB/IMDb id, else title + year |
| `roarzone` | RoarZone: Emby server at `play.roarzone.info` (public guest account) | Movies, series | TMDB/IMDb id, else title + year |
| `fmftp` | FMFTP: JSON API at `fmftp.net` | Movies, series | TMDB id, else title + year |
| `iccftp` | ICC FTP: `10.16.100.244` | Movies, series | Title + year |
| `ctgmovies` | CTGMovies: `ctgmovies.com`, files on `ctgfun.com` | Movies, series, anime | TMDB id |

**Not included:**
- **Live TV.** Nuvio asks plugins for streams of one specific movie or episode, so it has no place to show a channel list.
- **Non-BDIX public sites** from the upstream repos (9kMovies, BanglaPlex, and others).

---

## FAQ and troubleshooting

#### "Request failed with HTTP 404" when adding a CloudStream repo

CloudStream repos (`repo.json` → `plugins.json` → compiled `.cs3` Kotlin plugins) don't work in Nuvio. Nuvio appends `/manifest.json` to the URL you paste. For a CloudStream repo that produces `.../repo.json/manifest.json`, which doesn't exist. Use this repo's URL instead.

#### Loading is slow, or a source never returns anything

Your ISP probably can't reach that source's server. BDIX servers only answer ISPs that peer with them, and requests to an unreachable server aren't refused; they just go unanswered.

On Android, Nuvio waits up to **60 seconds** for such a server and then stops the scraper. That's also Nuvio's limit for a plugin call, so the source shows no streams or a timeout error. A scraper can't cut this short: Nuvio's `fetch` can't be cancelled, and scrapers have nowhere to remember an unreachable server between lookups.

Sources that are reachable return in a second or two, and Nuvio shows each source's streams as soon as that source finishes. The unreachable ones only keep the list in its loading state.

**Fix: disable every source your ISP can't reach** in Settings → Plugins. To see which ones work, open any popular movie and note the sources that return streams. Or test a server from a computer on the same network; a quick answer means reachable, a hang means not:

```bash
curl -I -m 10 http://172.16.50.14/DHAKA-FLIX-14/             # DhakaFlix
curl -I -m 10 http://new.circleftp.net:5000/                  # Circle FTP
curl -I -m 10 http://media.ftpbd.net:8096/emby/System/Info/Public  # FTPBD
curl -I -m 10 https://fmftp.net/                              # FMFTP
curl -I -m 10 http://10.16.100.244/                           # ICC FTP
```

#### A stream won't play

Some players won't follow a redirect from `https` to `http`, so scrapers resolve redirects before returning a link where they can. If a link still fails, check that your network can reach the file server's host shown in the stream URL; it is often a different host from the one the scraper searched.

#### Wrong title or episode

Sources without TMDB ids are matched by title and year, and some servers mislabel their own files. Please open an issue with the TMDB id, the season/episode, and the stream you got.

---

## How it works

Nuvio downloads `manifest.json` from the repository URL. For every enabled scraper it then downloads the JavaScript file named in `filename` and runs it in a sandboxed QuickJS engine.

When the user opens a title, Nuvio calls each scraper's exported function:

```js
getStreams(tmdbId, mediaType, season, episode) // mediaType: "movie" | "tv"
  -> Promise<Array<{ name, title, url, quality, size?, headers?, provider, type }>>
```

Every scraper here follows the same steps:

1. **Resolve the title.** Fetch the title, original title, year and IMDb id from TMDB (`src/common/tmdb.js`). Build a few search queries, for example `"Mission: Impossible - Dead Reckoning"` → also `"Mission: Impossible"`.
2. **Search the source** using its own API: h5ai search, the Emby Items API, a JSON API, or an HTML search page.
3. **Pick matches.** Use the exact TMDB/IMDb id where the source exposes one. Otherwise score each candidate by normalized title and year (`scoreCandidate` in `src/common/match.js`) and keep confident matches.
4. **Find the file.**
   - Movies: the video file(s) in the matched entry.
   - Series: the season folder or list, then the episode. Episodes are found by parsing names like `S02E03`, `2x03` and `Episode 3`, with position in the list as a fallback.
5. **Return streams.** Quality is detected from the file name or video height, size is attached when known, and any required headers (`Referer`, `User-Agent`) are included. Results are de-duplicated and sorted by quality.

`createProvider` (`src/common/stream.js`) wraps these steps so a scraper never throws. It sets no deadline of its own: Nuvio already stops a plugin call after 60 seconds, and a timer would delay the result (see [Nuvio runtime constraints](#nuvio-runtime-constraints)).

---

## Project structure

```
manifest.json            Repository manifest that Nuvio reads (list of scrapers)
providers/               GENERATED single-file bundles that Nuvio downloads. Do not edit.
src/
  providers/<id>.js      One file per source: search, matching and stream extraction
  common/
    http.js              fetch wrapper (never throws; timeouts only outside Nuvio), cookies, mapLimit, isAlive
    tmdb.js              TMDB lookup → { title, year, titles, queries, imdbId, isTv }
    match.js             Title normalization, release-name parsing, SxxEyy parsing, quality, size
    stream.js            makeStream() and createProvider() (the getStreams wrapper)
    h5ai.js              h5ai client: search plus folder listing (JSON API with HTML fallback)
    emby.js              Emby client: guest login, provider-id lookup, episodes, stream URLs
    dom.js               HTML helpers on top of Nuvio's built-in cheerio
build.js                 Bundles src/providers/*.js → providers/*.js with esbuild
scripts/
  test.js                Runs a built scraper against the real servers
  mock-test.js           Offline tests with mocked server responses
  nuvio-timing.js        Runs scrapers under Nuvio's timer and request rules to catch delays
```

The shared protocol clients cover several sources at once. For example, `ftpbd.js` and `roarzone.js` are each about 10 lines that call `createEmby()` with a server URL and guest login.

---

## Development

Requirements: Node.js 18 or newer.

```bash
npm install
npm run build              # build every scraper
node build.js dflix        # build specific scrapers
```

### Test against real servers

```bash
node scripts/test.js <id> <tmdbId> movie [--check]
node scripts/test.js <id> <tmdbId> tv <season> <episode> [--check]

# examples
node scripts/test.js circleftp 27205 movie --check     # Inception
node scripts/test.js ctgmovies 1399 tv 2 3 --check     # Game of Thrones S02E03
```

`--check` requests the first two bytes of every returned URL, to confirm the server answers with video (`206`) and not an error page. Set `TMDB_API_KEY` in your environment to use your own TMDB key.

BDIX servers are only reachable from certain ISPs, so a scraper returning `0 streams` locally may only mean your network can't reach it.

### Offline tests

```bash
npm run test:mock
```

These tests replace `fetch` with a fake that serves responses shaped like each server's real API or HTML. They cover search, matching and link building for every source, plus the "server unreachable" path, without needing BDIX access. Add a case to `scripts/mock-test.js` whenever you change parsing logic.

### Nuvio timing test

```bash
npm run test:nuvio                                 # every scraper: a movie and an episode
node scripts/nuvio-timing.js circleftp 27205 movie # one run
```

Nuvio only returns a scraper's result after every timer and request the scraper started has finished. This script reproduces that and prints when Nuvio would actually get the result:

```
ok   circleftp  27205 movie       1 streams | resolved 0.6s | Nuvio gets it at 0.6s
SLOW circleftp  27205 movie       1 streams | resolved 0.7s | Nuvio gets it at 50.6s
```

It exits with an error if any run keeps Nuvio waiting more than 1 second after `getStreams` resolved. Unreachable servers show Node's ~10 second connect timeout here; on Android, Nuvio waits up to 60 seconds.

### Publishing a change

1. Edit files under `src/`.
2. Run `npm run build` and commit the regenerated `providers/` files. Nuvio downloads those, not `src/`.
3. Bump the scraper's `version` in `manifest.json`, otherwise Nuvio may keep the cached copy.

Nuvio re-checks repositories about every 6 hours.

---

## Adding a new source

1. Create `src/providers/<id>.js`:

   ```js
   import { getJson } from '../common/http.js';
   import { scoreCandidate } from '../common/match.js';
   import { makeStream, createProvider } from '../common/stream.js';

   const ID = 'example';
   const LABEL = 'BDIX | Example';
   const BASE = 'http://example.bdix.local';

   async function run(info, season, episode) {
     // info = { isTv, tmdbId, imdbId, title, originalTitle, year, titles, queries }
     const results = (await getJson(BASE + '/api/search?q=' + encodeURIComponent(info.queries[0]))) || [];
     return results
       .filter((r) => scoreCandidate({ title: r.title, year: r.year }, info) >= 0.8)
       .map((r) => makeStream({ provider: ID, label: LABEL, url: r.fileUrl }));
   }

   export const getStreams = createProvider(ID, run);
   ```

   - If the server is h5ai or Emby, reuse `src/common/h5ai.js` or `createEmby()` instead of writing a new client.
   - Return early when a request returns `null`. That means the server is unreachable, so the scraper should fail fast.
   - Don't use `setTimeout`, `setInterval` or timeout timers. In Nuvio they hold the result back until they fire (see below).
2. Add an entry to `manifest.json`:

   ```json
   {
     "id": "example",
     "name": "Example (BDIX)",
     "description": "What it serves and which ISPs can reach it.",
     "version": "1.0.0",
     "author": "your-name",
     "supportedTypes": ["movie", "tv"],
     "filename": "providers/example.js",
     "enabled": true,
     "formats": ["mkv", "mp4"],
     "contentLanguage": ["en", "bn"]
   }
   ```
3. Run `npm run build`, test with `scripts/test.js` if you can reach the server, and add mock tests to `scripts/mock-test.js`.

---

## Nuvio runtime constraints

Scrapers don't run in Node. They run inside Nuvio's QuickJS sandbox, which differs in several ways:

- **One file per scraper.** Nuvio wraps the code in a function and reads `module.exports.getStreams`. `build.js` bundles everything into a single CommonJS file for that reason.
- **`require` is limited** to `cheerio-without-node-native` (also `cheerio` and `react-native-cheerio`) and `crypto-js`. There are no Node built-ins and no axios. `cheerio-without-node-native` is marked external in the build, so Nuvio's own copy is used.
- **Cheerio is partial.** Nuvio implements cheerio on top of Ksoup, a Jsoup port, so Jsoup-style CSS selectors work. Only these methods exist: `$(selector)`, `find`, `first`, `last`, `eq`, `each`, `map`, `filter`, `text`, `html`, `attr`, `next`, `prev`, `toArray`. `parent()` always returns an empty set, and `find()` can match the element itself. Use the helpers in `src/common/dom.js`.
- **`fetch` is native.** It supports `method`, `headers`, `body` and `redirect: 'manual'`. Network errors come back as `status: 0` instead of throwing, which `src/common/http.js` handles.
- **Requests can't be cancelled or timed out from JavaScript.** `fetch` ignores `AbortSignal`. On Android the native client waits up to 60 seconds to connect, so an unreachable server always uses up the whole call.
- **Timers delay the result.** `setTimeout` is a native sleep, and `clearTimeout` only stops the callback; the sleep keeps running. Nuvio returns a scraper's result only after every pending timer and request has finished. A 50-second "safety" timer therefore makes every call take 50 seconds. `src/common/http.js` only sets timeouts when it isn't running in Nuvio; `npm run test:nuvio` catches mistakes.
- **Plain `http://` is allowed**, which BDIX servers need.
- **Time limit.** Each call has 60 seconds, and at most 10 scrapers run at once.
- **TMDB key.** Nuvio provides one as `globalThis.TMDB_API_KEY`. `tmdb.js` uses it and falls back to a public key.
- **JavaScript level.** Modern syntax up to ES2020, including `async`/`await`, works. The build targets `es2020`.

---

## Contributing

Issues and pull requests are welcome, especially from people on ISPs that can reach sources the maintainers can't test.

- Keep each source in its own `src/providers/<id>.js`, and put reusable logic in `src/common/`.
- Run `npm run build`, `npm run test:mock` and `npm run test:nuvio` before opening a PR, and commit the regenerated `providers/` files.
- Bump the scraper's `version` in `manifest.json` when you change it.
- In the PR, say which ISP you tested from and which titles you tried.

---

## Credits and disclaimer

The scraping logic is based on the CloudStream extensions by [Niloy-Sarker](https://github.com/Niloy-Sarker/niloy-cloudstream) and [redowan99](https://github.com/redowan99/Redowan-CloudStream).

This project hosts no media. It only finds links on servers that ISPs make available to their own subscribers. Whether you may access that content is between you, your ISP and the content owners. Server addresses and guest accounts belong to their operators and may change or stop working at any time.
