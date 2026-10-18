// HTML parsing via Nuvio's native cheerio (Ksoup/Jsoup selectors under the hood).
// Only uses the subset Nuvio implements: $(sel), find, first, text, attr, toArray.

export function loadHtml(html) {
  // eslint-disable-next-line no-undef
  const cheerio = require('cheerio-without-node-native');
  return cheerio.load(html);
}

// Matching elements as individual wrappers. Works with both Nuvio's polyfill
// (toArray returns wrappers) and real cheerio (toArray returns nodes).
export function all($, selector, ctx) {
  const set = ctx ? ctx.find(selector) : $(selector);
  return set.toArray().map((x) => $(x));
}

export function text(el) {
  return (el.text() || '').replace(/\s+/g, ' ').trim();
}
