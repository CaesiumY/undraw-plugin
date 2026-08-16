#!/usr/bin/env node
/**
 * undraw.mjs — zero-dependency CLI for unDraw illustrations and handcrafts.
 *
 * Requires Node 18+ (uses the global `fetch`). No npm install, no package.json.
 *
 * Usage:
 *   node undraw.mjs search "<query>" [--limit 8] [--json]
 *   node undraw.mjs get "<media-url>" --out <path> [--color "#3b82f6"]
 *   node undraw.mjs handcrafts search "<query>" [--limit 8] [--json]
 *   node undraw.mjs handcrafts get <id> [--out <path>] [--color <c>] [--style bold|thin]
 *
 * Exit codes:
 *   0  success
 *   1  usage error (bad/missing arguments, ambiguous handcraft name)
 *   2  network or HTTP error, or the handcrafts page bundle changed shape
 *   3  no results / asset not found / response was not an SVG
 *   4  could not write the output file
 */

import { realpath } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.4.0';
const UA = `undraw-plugin/${VERSION} (+https://github.com/CaesiumY/undraw-plugin)`;

/** unDraw's default primary color, baked as a literal into every illustration. */
const DEFAULT_PRIMARY = '#6c63ff';

/** Handcrafts are drawn in `currentColor` instead, so they recolor differently. */
const DEFAULT_HANDCRAFT_COLOR = 'currentColor';

/**
 * What `recolor` looks for, per library.
 *
 * A descriptor rather than a bare token string, because the trailing guard is
 * token-specific and getting it wrong fails silently. `(?![0-9a-f])` exists for
 * the 8-digit-hex case and means nothing next to a keyword; a keyword instead
 * needs `(?![\w-])`, or `currentColorish` gets clipped into a color.
 */
const PRIMARY_HEX = { token: DEFAULT_PRIMARY, after: '(?![0-9a-f])' };
const CURRENT_COLOR = { token: DEFAULT_HANDCRAFT_COLOR, after: '(?![\\w-])' };

/** Attribution attributes undraw.co injects into its own downloads. */
const ATTRIBUTION = 'artist="Katerina Limpitsouni" copyright="unDraw"';

/** Local bounds on the search loop, so termination never depends on the remote API. */
const MAX_PAGES = 20;
const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Three rules that look like cleanup opportunities but are not. Do not "fix".
//
//  1. NEVER build a CDN URL from a slug. The path segment is inconsistent
//     across the catalog: newer entries live under /illustration/ (singular),
//     older ones under /illustrations/ (plural). Only the `media` field
//     returned by the API knows which. Assembling URLs 404s on half the set.
//
//  2. NEVER use /_next/data/<buildId>/... endpoints. `buildId` changes on
//     every undraw.co deploy, so those paths rot within days. /api/search and
//     /api/sitemap are the stable surfaces.
//
//  3. NEVER persist the parsed handcrafts catalog to disk. Writing it out is
//     literally "compiling assets from unDraw", which its license forbids —
//     see the Licensing section of the README. Each command re-reads /app and
//     its page chunk (~350 KB, about one large illustration). That second
//     round-trip is exactly what makes a cache file look tempting, which is
//     why the rule is written here rather than left to be inferred. For the
//     same reason there is no --chunk flag handing a URL from `search` to
//     `get`: the hash rots between invocations anyway.
// ---------------------------------------------------------------------------

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch (cause) {
    throw new CliError(`Network request failed: ${url}\n  ${cause.message}`, 2);
  }
  if (!res.ok) {
    throw new CliError(`HTTP ${res.status} ${res.statusText} for ${url}`, 2);
  }
  try {
    return await res.json();
  } catch (cause) {
    throw new CliError(`Response was not valid JSON: ${url}\n  ${cause.message}`, 2);
  }
}

/**
 * `notFoundCode` is a parameter because a 404 means different things to
 * different callers: a missing CDN asset is "no such result" (3), while a page
 * chunk that vanished between two requests is remote state moving under us (2),
 * and telling that caller to "try a broader term" would be nonsense.
 */
async function getText(url, { notFoundCode = 3 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch (cause) {
    throw new CliError(`Network request failed: ${url}\n  ${cause.message}`, 2);
  }
  if (res.status === 404) {
    throw new CliError(`Not found (404): ${url}`, notFoundCode);
  }
  if (!res.ok) {
    throw new CliError(`HTTP ${res.status} ${res.statusText} for ${url}`, 2);
  }
  return res.text();
}

/**
 * Search the catalog, paging until `limit` results are collected.
 * Returns [{ title, slug, media, previewUrl }].
 */
async function search(query, limit) {
  const collected = [];
  const seen = new Set();
  let offset = 0;
  let pages = 0;

  while (collected.length < limit && pages < MAX_PAGES) {
    const url = `https://undraw.co/api/search?q=${encodeURIComponent(query)}&offset=${offset}`;
    const page = await getJson(url);
    const results = Array.isArray(page?.results) ? page.results : [];
    if (results.length === 0) break;
    pages += 1;

    const before = collected.length;
    for (const r of results) {
      // `media` is the only trustworthy source of the SVG URL — see rule 1 above.
      // Dedupe on it too: an unstable sort or a clamped offset can repeat an
      // illustration across pages, and the same picture twice in a numbered
      // list is worse than a short list.
      if (!r?.media || seen.has(r.media)) continue;
      seen.add(r.media);
      collected.push({
        title: r.title ?? r.newSlug ?? '(untitled)',
        slug: r.newSlug ?? '',
        media: r.media,
        previewUrl: r.newSlug ? `https://undraw.co/illustration/${r.newSlug}` : r.media,
      });
      if (collected.length >= limit) break;
    }

    if (!page?.hasMore) break;
    // A full page that yielded nothing new means the response shape has drifted
    // (see rule 2 — undraw.co's surfaces do change) or the API is repeating
    // itself. Without this the loop keeps requesting forever, silently, which
    // is exactly the hammering the README promises this tool does not do.
    if (collected.length === before) break;
    offset += results.length;
  }

  return collected;
}

/**
 * Reduce a path-ish string to a bare basename.
 *
 * Splits on every character Windows forbids in a filename, not just the path
 * separators: a `:` creates an NTFS alternate data stream rather than the file
 * you asked for, and `? | " * < >` fail the write outright.
 */
const stripForbidden = (name) => name.split(/[/\\:*?"<>|]/).pop();

/** Drop leading dots, so remote input can never become `..` or a dotfile. */
const stripLeadingDots = (name) => name.replace(/^\.+/, '');

/**
 * Derive a default filename from a media URL.
 *
 * undraw.co's own downloader also strips "_re" globally, which corrupts slugs
 * that legitimately contain it (book_reading_xyz -> book_ading_xyz). We keep
 * the "undraw_" prefix convention but skip that destructive replace.
 *
 * The URL is remote input, so the decoded segment is reduced to a bare basename
 * with no leading dots before it is ever joined onto the output directory.
 */
function defaultFilename(mediaUrl) {
  const last = new URL(mediaUrl).pathname.split('/').pop() ?? '';
  let decoded;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last; // malformed percent-escape — keep the raw segment
  }
  let base = stripForbidden(decoded).replace(/\.svg$/i, '');
  // Loop rather than chain: a fixed order lets one prefix mask the other, so
  // "illustrations-undraw_x" would come out as "undraw_undraw_x".
  let previous;
  do {
    previous = base;
    base = base.replace(/^illustrations-/, '').replace(/^undraw_/, '');
  } while (base !== previous);
  base = stripLeadingDots(base);
  return `undraw_${base || 'illustration'}.svg`;
}

/**
 * Replace unDraw's literal primary color. The site emits it lowercase; we accept
 * either case. Returns the count so the caller can avoid claiming a recolor that
 * never happened.
 */
function recolor(svg, color, spec = PRIMARY_HEX) {
  let count = 0;
  // Escaped unconditionally. Neither token shipped today contains a regex
  // metacharacter, so this is a no-op — but it retires the entire class of
  // "someone adds a token with a `.` in it and the match quietly widens".
  const token = spec.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Function replacer, not a string: `$&` and friends are special in a string
  // replacement and would corrupt colors like `lab($' 0 0)`.
  // `spec.after` keeps the match off the first half of an 8-digit
  // #6c63ffAA: replacing only the leading 6 digits would strand the alpha pair
  // after the new value, which is merely odd for a hex target but produces
  // `oklch(…)80` — broken SVG — for a CSS Color 4 one.
  const out = svg.replace(new RegExp(`${token}${spec.after}`, 'gi'), () => {
    count += 1;
    return color;
  });
  return { svg: out, count };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toHex(...channels) {
  return `#${channels
    .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function hslToHex(h, s, l) {
  // CSS clamps out-of-range saturation/lightness rather than erroring.
  const sat = clamp(s, 0, 100) / 100;
  const lum = clamp(l, 0, 100) / 100;
  const a = sat * Math.min(lum, 1 - lum);
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => (lum - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255;
  return toHex(f(0), f(8), f(4));
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

/** Degrees from a CSS <angle>. Unknown units yield NaN rather than a wrong hue. */
function parseAngle(token) {
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return NaN;
  // `grad` must be tested before `rad` — "200grad" also ends in "rad".
  if (/grad$/i.test(token)) return n * 0.9;
  if (/rad$/i.test(token)) return (n * 180) / Math.PI;
  if (/turn$/i.test(token)) return n * 360;
  if (/deg$/i.test(token) || NUMBER.test(token)) return n;
  return NaN;
}

/** A percentage or bare number. Any other unit yields NaN. */
function parsePercent(token) {
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return NaN;
  return /%$/.test(token) || NUMBER.test(token) ? n : NaN;
}

/** An rgb() channel: `50%` is 127.5, `50` is 50. Anything else is NaN. */
function parseChannel(token) {
  const n = Number.parseFloat(token);
  if (!Number.isFinite(n)) return NaN;
  if (/%$/.test(token)) return (n / 100) * 255;
  return NUMBER.test(token) ? n : NaN;
}

/**
 * Accept the color formats real projects actually store, not just hex.
 *
 * Tailwind v4 and shadcn/ui keep theme colors in CSS as bare HSL channels
 * ("214 92% 58%") or as oklch(), never as hex — so a hex-only check rejects
 * exactly the values the skill just finished detecting.
 *
 * Returns { color, note }. HSL and RGB are converted to hex because hex renders
 * everywhere; CSS Color 4 functions are passed through untouched.
 */
function normalizeColor(input) {
  const raw = String(input).trim();

  // CSS hex is 3, 4, 6 or 8 digits — never 5 or 7. A 5-digit value parses here
  // but is ignored by every renderer, so the shape has to be exact.
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return { color: raw };

  const fn = raw.match(/^([a-z]+)\(\s*([^)]*)\)$/i);
  const name = fn?.[1].toLowerCase();
  const tokens = (fn ? fn[2] : raw).split(/[\s,/]+/).filter(Boolean);
  const dropped = (n) => (tokens.length > n ? ' (alpha dropped)' : '');

  const bareHsl =
    !fn && /^[-+]?[\d.]+(deg|rad|turn|grad)?\s+[-+]?[\d.]+%\s+[-+]?[\d.]+%$/i.test(raw);

  if (name === 'hsl' || name === 'hsla' || bareHsl) {
    const [h, s, l] = [parseAngle(tokens[0]), parsePercent(tokens[1]), parsePercent(tokens[2])];
    if (![h, s, l].every(Number.isFinite)) {
      throw new CliError(`Could not read the HSL channels in --color "${raw}".`, 1);
    }
    const hex = hslToHex(h, s, l);
    return { color: hex, note: `${raw} -> ${hex}${dropped(3)}` };
  }

  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b] = tokens.slice(0, 3).map(parseChannel);
    if (![r, g, b].every(Number.isFinite)) {
      throw new CliError(`Could not read the RGB channels in --color "${raw}".`, 1);
    }
    const hex = toHex(r, g, b);
    return { color: hex, note: `${raw} -> ${hex}${dropped(3)}` };
  }

  if (name && ['oklch', 'oklab', 'lab', 'lch', 'color', 'hwb'].includes(name)) {
    // Passed through verbatim, so the body must not carry anything that could
    // break the SVG it lands in.
    if (!/^[\w%.,\s/+-]*$/.test(fn[2])) {
      throw new CliError(`--color "${raw}" contains characters that are not valid in a CSS color.`, 1);
    }
    return { color: raw, note: `${raw} kept as-is (needs a CSS Color 4 renderer)` };
  }

  throw new CliError(
    `Could not read --color "${raw}".\n` +
      '  Accepted: #3b82f6 | hsl(214 92% 58%) | "214 92% 58%" | rgb(49 130 246) | oklch(...)',
    1,
  );
}

/**
 * Matches the document's ROOT `<svg` token, allowing an XML declaration,
 * DOCTYPE, or comments ahead of it.
 *
 * Anchored deliberately: an unanchored `<svg` also matches the inline logo that
 * CDN and proxy error pages embed, so a 200-with-HTML 502 page would sail
 * through validation and be written out as an .svg.
 */
const ROOT_SVG =
  /^\s*(?:<\?xml[^>]*\?>\s*|<!DOCTYPE(?:[^>[]|\[[^\]]*\])*>\s*|<!--(?:[^-]|-(?!->))*-->\s*)*<svg(?=[\s/>])/i;
// Three details in there are load-bearing:
//
//  * The root token ends with `(?=[\s/>])`, not `\b`. A word boundary also sits
//    between the `g` and the `:` of a namespaced root `<svg:svg>`, which put the
//    insertion point inside the element name: the root got renamed to `svg` and
//    a stray `:svg` was left where an attribute should be, producing XML no
//    parser accepts. undraw does not emit namespaced roots, so rejecting them
//    loudly beats corrupting them quietly.
//
//  * The comment body is `(?:[^-]|-(?!->))*`, not `[\s\S]*?`. A lazy dot can run
//    past one comment's `-->` into the next, so K sibling comments admit 2^(K-1)
//    ways to split the prologue. When the trailing `<svg` then fails to match,
//    the engine tries all of them: a 209-byte body took 350ms, and each extra
//    comment doubles it.
//  * DOCTYPE is `(?:[^>[]|\[[^\]]*\])*`, not `[^>]*`, so an internal subset —
//    `<!DOCTYPE svg [ <!ENTITY … > ]>` — does not terminate the match at the
//    `>` inside the brackets and get the whole file rejected.

const WS = /\s/;

/**
 * Lowercased attribute NAMES on one tag, scanning from just after its token
 * (i.e. from the offset right after `<svg` or `<path`).
 *
 * Tag-agnostic on purpose — the handcrafts attribution has to ask the same
 * question about the first `<path>` that the illustration one asks about the
 * root `<svg>`.
 *
 * This is a scanner rather than a regex on purpose. Attribute names are only
 * distinguishable from attribute *values* by tracking quoting, and every regex
 * approximation of "does the tag carry artist=" has a hole: `\bartist=` also
 * matches `data-artist=`, and `(?:^|\s)artist=` also matches a value such as
 * `data-x=" artist=1"`. Both suppress the attribution silently.
 *
 * Tolerant of malformed input by design — it stops at the tag's end, at the
 * end of the string, and treats unquoted values as running to whitespace.
 */
function tagAttributeNames(svg, from) {
  const names = new Set();
  let i = from;
  while (i < svg.length) {
    while (i < svg.length && WS.test(svg[i])) i++;
    if (i >= svg.length || svg[i] === '>') break;
    if (svg[i] === '/') {
      i++;
      continue;
    }
    const start = i;
    while (i < svg.length && !WS.test(svg[i]) && !'=/>'.includes(svg[i])) i++;
    const name = svg.slice(start, i).toLowerCase();
    while (i < svg.length && WS.test(svg[i])) i++;
    if (svg[i] === '=') {
      i++;
      while (i < svg.length && WS.test(svg[i])) i++;
      const quote = svg[i];
      if (quote === '"' || quote === "'") {
        i++;
        while (i < svg.length && svg[i] !== quote) i++;
        i++;
      } else {
        while (i < svg.length && !WS.test(svg[i]) && svg[i] !== '>') i++;
      }
    }
    if (name) names.add(name);
  }
  return names;
}

/** Does this text parse as an SVG document (rather than merely contain one)? */
const isSvg = (text) => ROOT_SVG.test(text);

/** Reject anything that is not actually an SVG before it is written as one. */
function assertSvg(text, source) {
  if (!isSvg(text)) {
    const head = text.slice(0, 60).replace(/\s+/g, ' ').trim();
    throw new CliError(`Response from ${source} is not an SVG (starts with "${head}").`, 3);
  }
}

/**
 * Insert attributes into one tag. Idempotent, given the right guards.
 *
 * The attributes go in right after the tag's token rather than by rewriting the
 * whole opening tag: rewriting lowercases `<SVG>` (breaking the case-sensitive
 * XML match with `</SVG>`) and mangles tags whose attribute values contain `>`.
 *
 * `guards` are lowercased attribute names that mean "already attributed".
 * Listing every attribute being added matters: guarding on `artist` alone
 * appends a second `copyright` to a tag that already has one, and duplicate
 * attributes are a fatal XML error — the exact failure this exists to avoid.
 */
function injectAttributes(text, findInsertion, attrs, guards) {
  const at = findInsertion(text);
  if (at < 0) return text;
  // Read names off THIS TAG only. Scanning the whole document cuts both ways: a
  // <desc> that merely mentions the artist would suppress the real attribution,
  // while a tag that already uses single quotes would get a second artist=.
  const names = tagAttributeNames(text, at);
  if (guards.some((guard) => names.has(guard))) return text;
  return `${text.slice(0, at)} ${attrs}${text.slice(at)}`;
}

/** Offset just past the root `<svg` token, or -1 when there is no root. */
function findRootSvg(text) {
  const match = text.match(ROOT_SVG);
  return match ? match[0].length : -1;
}

/** Add unDraw's illustration attribution attributes. Idempotent. */
const attribute = (svg) => injectAttributes(svg, findRootSvg, ATTRIBUTION, ['artist', 'copyright']);

// ===========================================================================
// Handcrafts — handcrafts.undraw.co
//
// A different library with different mechanics at every step: no API, no CDN
// URL, no per-item page, `currentColor` instead of a literal hex, and a
// different attribution attribute set. The commands are kept separate for that
// reason rather than hidden behind a --source flag.
// ===========================================================================

const HANDCRAFTS_ORIGIN = 'https://handcrafts.undraw.co';
const HANDCRAFTS_APP = `${HANDCRAFTS_ORIGIN}/app`;

const HANDCRAFT_CREATOR = 'creator="Katerina Limpitsouni"';
const HANDCRAFT_ORIGIN = 'origin="undraw"';

/** Local bounds, so no bundle — drifted, huge or hostile — can hang the parser. */
const MAX_CHUNK_CHARS = 8_000_000; // the real chunk is ~350 KB
const MAX_OBJECT_CHARS = 1_000_000;
const MAX_OBJECT_FIELDS = 64;
const MAX_SCAN_ITEMS = 2000;
/** The catalog is 66 usable entries today; well under this means the shape moved. */
const MIN_CATALOG_ITEMS = 20;

/**
 * Page-chunk paths referenced by /app's HTML.
 *
 * `(?:src|href)` because Next.js emits the same chunk as a `<script src>` and a
 * `<link rel=preload href>`; matching only `src` works today and is one build
 * config change away from silently finding nothing.
 *
 * The path class is bounded rather than `[^"]+`, so a captured path can never
 * carry anything that changes how `new URL()` resolves it — and the required
 * leading `/` on its own rejects `src="https://evil.example/_next/…"`.
 */
function findCatalogChunkPaths(html) {
  const pattern = /(?:src|href)="(\/_next\/static\/chunks\/pages\/app-[A-Za-z0-9._-]+\.js)"/g;
  return [...new Set([...html.matchAll(pattern)].map((match) => match[1]))];
}

const SIMPLE_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * One JS string literal starting at src[i], which must be a quote character.
 *
 * This is the ONLY place in the file that knows JS string escaping, and it
 * should stay that way: every "the object ended early" bug in a scanner like
 * this one is a string-state bug, so a second copy is a second bug.
 *
 * Escapes it does not recognise (`\u{1F600}`, say) contribute the character
 * itself rather than failing. That is wrong in the letter but right in the
 * consequence: it never truncates the value, which is the only failure mode
 * here that would corrupt an SVG.
 */
function readStringLiteral(src, i) {
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let value = '';
  for (let j = i + 1; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === quote) return { value, end: j + 1 };
    if (ch !== '\\') {
      value += ch;
      continue;
    }
    const escape = src[j + 1];
    if (escape === undefined) break; // trailing backslash — unterminated
    j += 1;
    if (escape === '\n') continue; // line continuation contributes nothing
    if (escape === 'u' || escape === 'x') {
      const width = escape === 'u' ? 4 : 2;
      const hex = src.slice(j + 1, j + 1 + width);
      if (hex.length === width && /^[0-9a-f]+$/i.test(hex)) {
        value += String.fromCharCode(Number.parseInt(hex, 16));
        j += width;
        continue;
      }
    }
    value += SIMPLE_ESCAPES[escape] ?? escape;
  }
  return null; // ran off the end without a closing quote
}

/** Skip a balanced `{…}` or `[…]`, stepping over strings. Returns -1 if unbalanced. */
function skipBalanced(src, start, limit) {
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let i = start;
  while (i < limit) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const read = readStringLiteral(src, i);
      if (!read) return -1;
      i = read.end;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close && (depth -= 1) === 0) return i + 1;
    i += 1;
  }
  return -1;
}

/**
 * One object literal starting at src[start] (a `{`), read by KEY rather than by
 * position, and returning its own end offset.
 *
 * Key-driven so that reordering upstream — `{title:…,_id:…}` instead of
 * `{_id:…,title:…}` — reads identically instead of looking like drift.
 *
 * Returns null on anything it cannot follow (computed key, unterminated string,
 * budget exceeded); the caller skips that item rather than failing the run.
 *
 * It does NOT handle regex literals or comments, and must not be "hardened" to.
 * Inside a data object literal a `/` can only occur within a string, and string
 * tracking already covers that — including the `</svg>` in every value here.
 */
function readObjectLiteral(src, start) {
  if (src[start] !== '{') return null;
  const fields = new Map();
  const limit = Math.min(src.length, start + MAX_OBJECT_CHARS);
  let i = start + 1;

  while (i < limit) {
    while (i < limit && (WS.test(src[i]) || src[i] === ',')) i += 1;
    if (i >= limit) return null;
    if (src[i] === '}') return { fields, end: i + 1 };
    if (fields.size >= MAX_OBJECT_FIELDS) return null;

    let key;
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const read = readStringLiteral(src, i);
      if (!read) return null;
      key = read.value;
      i = read.end;
    } else {
      const from = i;
      while (i < limit && /[\w$]/.test(src[i])) i += 1;
      if (i === from) return null; // computed key `[x]`, or something unexpected
      key = src.slice(from, i);
    }

    while (i < limit && WS.test(src[i])) i += 1;
    if (src[i] !== ':') return null;
    i += 1;
    while (i < limit && WS.test(src[i])) i += 1;

    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const read = readStringLiteral(src, i);
      if (!read) return null;
      fields.set(key, { type: 'string', value: read.value });
      i = read.end;
    } else if (ch === '{' || ch === '[') {
      const end = skipBalanced(src, i, limit);
      if (end < 0) return null;
      fields.set(key, { type: 'other', value: null });
      i = end;
    } else {
      const from = i;
      while (i < limit && src[i] !== ',' && src[i] !== '}') i += 1;
      const raw = src.slice(from, i).trim();
      const num = Number(raw);
      fields.set(
        key,
        raw !== '' && Number.isFinite(num) ? { type: 'number', value: num } : { type: 'other', value: raw },
      );
    }
  }
  return null;
}

/** Turn one parsed object into a catalog item, or null if it is not one. */
function toCatalogItem(fields) {
  const id = fields.get('_id');
  const title = fields.get('title');
  if (id?.type !== 'number' || !Number.isInteger(id.value)) return null;
  if (title?.type !== 'string' || !title.value.trim()) return null;

  const body = (key) => {
    const field = fields.get(key);
    const svg = field?.type === 'string' ? field.value : '';
    return isSvg(svg) ? svg : '';
  };
  const bold = body('b');
  const thin = body('t');
  // _id:1800 "Circled X" ships with b:"" and t:"" — a placeholder carrying no
  // artwork. It has to be dropped here rather than at `get` time, or it appears
  // in the numbered list, the user picks that number, and gets an empty file.
  if (!bold && !thin) return null;
  // _id:1359 "Sneaker" has only a thin variant, so one empty side is normal and
  // must not disqualify the item.

  const keywords = fields.get('keywords');
  return {
    id: id.value,
    title: title.value.trim(),
    // Missing keywords is degraded, not fatal — the item is still gettable by id.
    keywords: keywords?.type === 'string' ? keywords.value : '',
    styles: { bold, thin },
  };
}

/**
 * The handcrafts catalog, read out of a page chunk.
 *
 * Anchored on `{_id:<digits>` and nothing more. Requiring `,title:"` to follow
 * as well would mean a reordering of the later keys read as drift, when the
 * object is in fact perfectly readable.
 *
 * The one positional assumption left is that `_id` LEADS the object. Removing
 * it would mean anchoring on a bare `_id:` and scanning backwards for the `{`,
 * and a backward scan through minified JS cannot be made quote-aware — reading
 * right to left you cannot tell whether a `'` opens or closes a string. That
 * trades a safe failure for a possible silent one: if the key order ever does
 * change, the drift guard below stops with an actionable message, which is a
 * much better outcome than an anchor landing inside a string value.
 */
function parseHandcraftsCatalog(chunk, source = HANDCRAFTS_APP) {
  // Built per call: a module-level /g regex carries `lastIndex` between calls.
  const anchor = /\{\s*_id\s*:\s*\d+\s*[,}]/g;
  const items = [];
  let scanned = 0;
  let match;

  while ((match = anchor.exec(chunk)) !== null && scanned < MAX_SCAN_ITEMS) {
    scanned += 1;
    const object = readObjectLiteral(chunk, match.index);
    if (!object) {
      anchor.lastIndex = match.index + 1;
      continue;
    }
    const item = toCatalogItem(object.fields);
    if (item) items.push(item);
    // Resume past the object, never inside it. This one line does two jobs: a
    // `{_id:…}` sitting inside a string VALUE can never become a phantom item,
    // and the scan stays O(n) instead of re-reading each object from every
    // anchor nested within it.
    anchor.lastIndex = object.end;
  }

  if (items.length < MIN_CATALOG_ITEMS) {
    throw new CliError(
      `Could not read the handcrafts catalog: found ${items.length} usable item(s) in ${source} ` +
        `(expected at least ${MIN_CATALOG_ITEMS}).\n` +
        '  handcrafts.undraw.co has no API, so the catalog is read out of the page bundle.\n' +
        '  An upstream redesign breaks this. Please report it:\n' +
        '  https://github.com/CaesiumY/undraw-plugin/issues',
      2,
    );
  }
  return items;
}

/** A filename-safe slug for a title, which is remote input like any URL segment. */
function titleSlug(title) {
  const slug = stripLeadingDots(stripForbidden(String(title)))
    .toLowerCase()
    .replace(/\s+/g, '-') // the site's own convention
    // Unicode letters are kept deliberately. Every handcrafts title is ASCII
    // today, but an ASCII-only allowlist would collapse any future non-ASCII
    // title into the fallback, and undraw_화살표_7.svg beats undraw_handcraft_7.svg.
    // This also drops control characters — a NUL in a path is an EINVAL at write
    // time, which surfaces as an inscrutable exit 4.
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  // Capped so an absurd title fails as a short name rather than as ENAMETOOLONG.
  return slug.slice(0, 60).replace(/[-.]+$/, '');
}

/**
 * The name a handcraft is saved under.
 *
 * The id is not decoration. Two entries are both titled "Circled Arrow" (1375
 * and 1675), so the site's own `undraw_circled-arrow.svg` convention makes the
 * second save silently destroy the first with `Saved …` as the only output —
 * the same class of accident the "don't clobber hero.png" guard exists to stop.
 * It also matches the illustrations' undraw_secure-login_m11a.svg shape, where
 * the disambiguator already comes last.
 *
 * Only `thin` is suffixed: bold is the site default, so the common case stays
 * short, and typing --style bold explicitly yields the same name as omitting it.
 */
function handcraftFilename(title, id, style) {
  const slug = titleSlug(title) || 'handcraft';
  return `undraw_${slug}_${id}${style === 'thin' ? '_thin' : ''}.svg`;
}

/**
 * Search the catalog.
 *
 * undraw's own filter is one substring test against `keywords`. This searches
 * the title too — a strict superset, so it can never withhold a result the site
 * would show — because with no per-item page the title is the only handle the
 * user has, and "search for the one you just showed me" has to work.
 */
function matchHandcrafts(catalog, query, limit) {
  const needle = String(query).trim().toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const item of catalog) {
    const title = item.title.toLowerCase();
    const haystack = `${title} ${item.keywords.toLowerCase()}`;
    // Tokens are ANDed rather than matched as one substring. The site's whole
    // string test misses "circled arrow" outright: keywords are comma-space
    // delimited, so that literal pair never occurs in them.
    if (!tokens.every((token) => haystack.includes(token))) continue;

    let score = tokens.filter((token) => title.includes(token)).length;
    if (title === needle) score += 8;
    else if (title.startsWith(needle)) score += 4;
    else if (title.includes(needle)) score += 2;
    scored.push({ item, score });
  }

  // Deterministic, id as the tie-break. The user answers "2번" against this
  // list, so two runs must never number the same results differently.
  scored.sort((a, b) => b.score - a.score || a.item.id - b.item.id);
  return scored.slice(0, limit).map((entry) => entry.item);
}

/** Resolve an id or a title slug to exactly one item, or throw. */
function resolveHandcraft(catalog, ref) {
  const raw = String(ref).trim();

  if (/^\d+$/.test(raw)) {
    const id = Number.parseInt(raw, 10);
    const found = catalog.find((item) => item.id === id);
    if (found) return found;
    // Deliberately no fall-through to slug matching: no title is all digits, so
    // a numeric miss is a typo, and quietly resolving it to some title would be
    // the surprising outcome rather than the helpful one.
    throw new CliError(
      `No handcraft with id ${id}.\n  Run: node undraw.mjs handcrafts search "<term>"`,
      3,
    );
  }

  // Exact slug equality, not substring. "arrow" is a substring of Arrow, Fun
  // Arrow and Circled Arrow, so substring matching turns the commonest word in
  // the catalog into an ambiguity error; equality resolves it to "Arrow".
  const slug = titleSlug(raw);
  const matches = catalog.filter((item) => titleSlug(item.title) === slug);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new CliError(
      `No handcraft named "${raw}".\n  Run: node undraw.mjs handcrafts search "<term>"`,
      3,
    );
  }
  const candidates = matches.map((item) => `    ${item.id}  ${item.title}`).join('\n');
  throw new CliError(
    `"${raw}" matches ${matches.length} handcrafts. Pass the id instead:\n${candidates}`,
    1,
  );
}

/** Is this offset inside an XML comment? */
function inComment(text, index) {
  const open = text.lastIndexOf('<!--', index);
  return open !== -1 && text.indexOf('-->', open) > index;
}

/**
 * Offset just past the first real `<path` token, or -1.
 *
 * Mirrors the site's `querySelector("path")`: document order, first match, at
 * any depth — eight catalog entries wrap their paths in a `<g>`. The
 * `(?=[\s/>])` lookahead is the same trick ROOT_SVG uses, so `<pathological>`
 * is not mistaken for a path.
 */
function findFirstPath(text) {
  for (const match of text.matchAll(/<path(?=[\s/>])/gi)) {
    if (!inComment(text, match.index)) return match.index + match[0].length;
  }
  return -1;
}

/**
 * Add the attribution handcrafts.undraw.co's own download button writes:
 * `creator` on the root `<svg>`, `origin` on the first `<path>`. Idempotent.
 *
 * Two independent guards on purpose — a root that already carries `creator`
 * must not stop `origin` from reaching the path. An SVG with no `<path>` at all
 * simply keeps its root attribution.
 */
function attributeHandcraft(svg) {
  const withCreator = injectAttributes(svg, findRootSvg, HANDCRAFT_CREATOR, ['creator']);
  return injectAttributes(withCreator, findFirstPath, HANDCRAFT_ORIGIN, ['origin']);
}

/**
 * The half of `--out` validation that needs neither the network nor a filename,
 * so both `get` paths can reject a bad flag before spending a request.
 */
function assertOutFlag(out) {
  if (out !== undefined && typeof out !== 'string') {
    throw new CliError('--out needs a path, e.g. --out public/illustrations', 1);
  }
}

/** Where the SVG actually lands: `--out` is a file only when it ends in .svg. */
async function resolveOutPath(out, filename) {
  const { stat } = await import('node:fs/promises');
  const path = await import('node:path');

  const outPath = out ?? filename;
  const existing = await stat(outPath).catch(() => null);
  // The ".svg means file" rule has to hold for paths that already exist too,
  // or the same flag means opposite things depending on what is on disk. An
  // agent told "replace src/assets/hero.png" would otherwise expect a new
  // directory and instead destroy hero.png, with `Saved …` as the only output.
  if (existing && !existing.isDirectory() && !/\.svg$/i.test(outPath)) {
    throw new CliError(
      `--out "${outPath}" is an existing file that is not a .svg, so writing an SVG there would destroy it.\n` +
        '  Pass a path ending in .svg, or a directory.',
      1,
    );
  }
  // Not on disk yet: only a path already ending in .svg is a file. Testing for
  // "has any extension" instead misreads dotted directory names such as
  // src/assets/v1.0, which would silently become an extensionless file.
  const isDir = existing ? existing.isDirectory() : !/\.svg$/i.test(outPath);
  return isDir ? path.join(outPath, filename) : outPath;
}

/** `--limit`, shared by both searches. `true` means the flag was passed bare. */
function parseLimit(raw = '8') {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    throw new CliError(`--limit must be a positive integer, got "${raw}"`, 1);
  }
  const limit = Number.parseInt(raw, 10);
  if (limit > MAX_LIMIT) {
    throw new CliError(`--limit is capped at ${MAX_LIMIT}, got ${limit}.`, 1);
  }
  return limit;
}

async function writeSvg(outPath, svg) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  try {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, svg, 'utf8');
  } catch (cause) {
    throw new CliError(`Could not write ${outPath}\n  ${cause.message}`, 4);
  }
}

async function cmdSearch(args) {
  const query = args._[0];
  if (!query) throw new CliError('search requires a query.\n  node undraw.mjs search "login"', 1);
  // Only the first positional is used, so an unquoted multi-word query would
  // silently search for its first word and return plausible-looking results.
  if (args._.length > 1) {
    throw new CliError(
      `search takes one query, got ${args._.length} arguments.\n` +
        `  Quote it: node undraw.mjs search "${args._.join(' ')}"`,
      1,
    );
  }

  const results = await search(query, parseLimit(args.limit));
  if (results.length === 0) {
    throw new CliError(`No illustrations matched "${query}". Try a broader term.`, 3);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${results.length} result(s) for "${query}":\n\n`);
  results.forEach((r, i) => {
    process.stdout.write(`${String(i + 1).padStart(2)}. ${r.title}\n`);
    process.stdout.write(`    preview: ${r.previewUrl}\n`);
    process.stdout.write(`    media:   ${r.media}\n\n`);
  });
}

async function cmdGet(args) {
  const mediaUrl = args._[0];
  if (!mediaUrl) {
    throw new CliError(
      'get requires the media URL from `search` output (not a slug).\n' +
        '  node undraw.mjs get "https://cdn.undraw.co/illustration/foo_ab12.svg" --out ./public',
      1,
    );
  }
  let parsed;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    throw new CliError(`Not a valid URL: "${mediaUrl}". Pass the \`media\` field from search output.`, 1);
  }
  if (parsed.hostname !== 'cdn.undraw.co') {
    throw new CliError(`Expected a cdn.undraw.co URL, got "${parsed.hostname}".`, 1);
  }
  assertOutFlag(args.out);
  // Validate everything cheap before spending a request.
  const color = args.color ? normalizeColor(args.color) : null;

  const outPath = await resolveOutPath(args.out, defaultFilename(mediaUrl));

  // Everything above is decidable without the network, so a usage error costs
  // no request and reports exit 1 rather than being masked by a transport
  // failure that happened to come first.
  let svg = await getText(mediaUrl);
  assertSvg(svg, mediaUrl);

  let replaced = 0;
  if (color) ({ svg, count: replaced } = recolor(svg, color.color));
  svg = attribute(svg);

  await writeSvg(outPath, svg);

  process.stdout.write(`Saved ${outPath}\n`);
  if (color) {
    if (replaced === 0) {
      process.stderr.write(
        `Warning: this illustration contains no ${DEFAULT_PRIMARY}, so --color changed nothing.\n`,
      );
    } else {
      process.stdout.write(`Recolored ${DEFAULT_PRIMARY} -> ${color.color} (${replaced}x)\n`);
      if (color.note) process.stdout.write(`  ${color.note}\n`);
    }
  }
}

/**
 * Fetch /app, find its page chunk, and read the catalog out of it.
 *
 * Two round-trips every time, and deliberately not cached to disk — rule 3.
 */
async function loadHandcraftsCatalog() {
  const html = await getText(HANDCRAFTS_APP, { notFoundCode: 2 });
  const [chunkPath] = findCatalogChunkPaths(html);
  if (!chunkPath) {
    throw new CliError(
      `No page chunk found in ${HANDCRAFTS_APP}.\n` +
        '  handcrafts.undraw.co has no API, so the catalog is read out of the page bundle.\n' +
        '  An upstream redesign breaks this. Please report it:\n' +
        '  https://github.com/CaesiumY/undraw-plugin/issues',
      2,
    );
  }

  const url = new URL(chunkPath, HANDCRAFTS_ORIGIN);
  // Unconditional, even though `findCatalogChunkPaths` only returns rooted
  // paths: this path came out of a remote page, and one assertion here is
  // cheaper than trusting that the regex above never loosens.
  if (url.origin !== HANDCRAFTS_ORIGIN) {
    throw new CliError(`Refusing to read a catalog chunk from ${url.origin}.`, 2);
  }

  const chunk = await getText(url.href, { notFoundCode: 2 });
  if (chunk.length > MAX_CHUNK_CHARS) {
    throw new CliError(
      `${url.href} is ${chunk.length} characters, past the ${MAX_CHUNK_CHARS} cap — refusing to parse it.`,
      2,
    );
  }
  return parseHandcraftsCatalog(chunk, url.href);
}

/** Which variants this item actually ships. Some entries have only one. */
const styleNames = (item) =>
  [item.styles.bold && 'bold', item.styles.thin && 'thin'].filter(Boolean);

async function cmdHandcraftsSearch(args) {
  const query = args._[0];
  if (!query) {
    throw new CliError(
      'handcrafts search requires a query.\n  node undraw.mjs handcrafts search "arrow"',
      1,
    );
  }
  if (args._.length > 1) {
    throw new CliError(
      `handcrafts search takes one query, got ${args._.length} arguments.\n` +
        `  Quote it: node undraw.mjs handcrafts search "${args._.join(' ')}"`,
      1,
    );
  }
  const limit = parseLimit(args.limit);

  const results = matchHandcrafts(await loadHandcraftsCatalog(), query, limit);
  if (results.length === 0) {
    // The catalog is only ~66 marks, so a miss is common and a nudge is worth
    // more than "try a broader term".
    throw new CliError(
      `No handcrafts matched "${query}".\n` +
        '  The catalog is small — try: arrow, underline, circle, star, heart, check.',
      3,
    );
  }

  if (args.json) {
    // No previewUrl field, deliberately. handcrafts has no per-item page, and a
    // per-item field holding a not-per-item value is a link an agent will print.
    const json = results.map((item) => ({
      id: item.id,
      title: item.title,
      keywords: item.keywords,
      styles: styleNames(item),
    }));
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${results.length} result(s) for "${query}":\n\n`);
  results.forEach((item, i) => {
    process.stdout.write(`${String(i + 1).padStart(2)}. ${item.title}  (id ${item.id})\n`);
    if (item.keywords) process.stdout.write(`    keywords: ${item.keywords}\n`);
    // Not decoration: some entries ship one variant only, and without this the
    // caller offers `--style thin` and walks the user into an exit 3.
    process.stdout.write(`    styles:   ${styleNames(item).join(', ')}\n`);
    process.stdout.write(`    get:      node undraw.mjs handcrafts get ${item.id}\n\n`);
  });
  // Said plainly because the sibling illustrations command prints a preview URL
  // for every result, which trains exactly the wrong habit here.
  process.stdout.write(
    `No preview URLs — handcrafts has no per-item page.\nBrowse them all at ${HANDCRAFTS_APP}\n`,
  );
}

async function cmdHandcraftsGet(args) {
  const ref = args._[0];
  if (!ref) {
    throw new CliError(
      'handcrafts get requires an id from `handcrafts search` output.\n' +
        '  node undraw.mjs handcrafts get 1 --out ./public/icons',
      1,
    );
  }
  if (args._.length > 1) {
    throw new CliError(
      `handcrafts get takes one id or name, got ${args._.length} arguments.\n` +
        `  Quote it: node undraw.mjs handcrafts get "${args._.join(' ')}"`,
      1,
    );
  }
  assertOutFlag(args.out);

  // Whether --style was TYPED decides what happens below when the item lacks
  // that variant, so keep the raw value rather than defaulting it away.
  const requested = args.style;
  if (requested !== undefined && !['bold', 'thin'].includes(requested)) {
    throw new CliError(`--style must be "bold" or "thin", got "${requested}".`, 1);
  }
  const wanted = requested ?? 'bold';
  const color = args.color ? normalizeColor(args.color) : null;

  const item = resolveHandcraft(await loadHandcraftsCatalog(), ref);

  let style = wanted;
  if (!item.styles[style]) {
    const other = style === 'bold' ? 'thin' : 'bold';
    if (requested !== undefined || !item.styles[other]) {
      throw new CliError(
        `"${item.title}" (id ${item.id}) has no ${style} variant.` +
          (item.styles[other] ? ` Try --style ${other}.` : ''),
        3,
      );
    }
    // The user never asked for bold — it is only the default. Failing on a
    // default nobody typed would be gratuitous, so fall back and say so aloud.
    // "Sneaker" (id 1359) is the live entry this exists for.
    style = other;
    process.stdout.write(`"${item.title}" has no ${wanted} variant — using ${other}.\n`);
  }

  let svg = item.styles[style];
  const source = `${HANDCRAFTS_APP} (id ${item.id}, ${style})`;
  // The parser already filters non-SVG bodies out of search results; this
  // guards the write itself, which is the part that cannot be taken back.
  assertSvg(svg, source);

  // Unlike `get`, the filename is only knowable after the fetch, so this guard
  // lands after ~350 KB has moved. Nothing is written before it, so the cost is
  // the round-trip rather than the file.
  const outPath = await resolveOutPath(args.out, handcraftFilename(item.title, item.id, style));

  let replaced = 0;
  if (color) ({ svg, count: replaced } = recolor(svg, color.color, CURRENT_COLOR));
  svg = attributeHandcraft(svg);

  await writeSvg(outPath, svg);
  process.stdout.write(`Saved ${outPath}\n`);

  if (!color) {
    // The middle line is the one that matters. `currentColor` renders BLACK the
    // moment the file is used as an <img src> or a background-image, and that
    // is the likeliest way this feature turns into a bug report. The CLI is
    // documented as usable on its own, so the skill cannot be the only place
    // this is written down.
    process.stdout.write(
      `Kept ${DEFAULT_HANDCRAFT_COLOR} — the artwork inherits the CSS \`color\` around it.\n` +
        '  Note: an <img src> or CSS background cannot inherit, and renders it black.\n' +
        '  Inline the SVG for that to work, or pass --color to bake a color in.\n',
    );
  } else if (replaced === 0) {
    process.stderr.write(
      `Warning: this handcraft contains no ${DEFAULT_HANDCRAFT_COLOR}, so --color changed nothing.\n`,
    );
  } else {
    process.stdout.write(`Recolored ${DEFAULT_HANDCRAFT_COLOR} -> ${color.color} (${replaced}x)\n`);
    if (color.note) process.stdout.write(`  ${color.note}\n`);
  }
}

const HANDCRAFTS_USAGE = `undraw handcrafts — hand-drawn accents from handcrafts.undraw.co

  node undraw.mjs handcrafts search "<query>" [--limit 8] [--json]
  node undraw.mjs handcrafts get <id> [--out <path>] [--color "#3b82f6"] [--style bold|thin]

Pass the id from search output. Titles are not unique — two entries are both
called "Circled Arrow" — so a name matching more than one is an error, not a guess.

--color is optional. Left off, the artwork keeps \`currentColor\` and inherits the
CSS color around it, which is usually what you want for an inline SVG.
`;

async function cmdHandcrafts(rest) {
  const [sub, ...tail] = rest;
  switch (sub) {
    case 'search':
      return cmdHandcraftsSearch(parseArgs(tail));
    case 'get':
      return cmdHandcraftsGet(parseArgs(tail));
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HANDCRAFTS_USAGE);
      return;
    default:
      throw new CliError(`Unknown handcrafts command "${sub}".\n\n${HANDCRAFTS_USAGE}`, 1);
  }
}

/** Flags that never consume the next token, so positionals after them survive. */
const BOOLEAN_FLAGS = new Set(['json', 'help']);

/** Minimal flag parser: --key value, --key=value, and boolean --flag. */
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [key, inlineValue] = token.slice(2).split(/=(.*)/s);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true;
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      args[key] = argv[++i];
    } else {
      args[key] = true;
    }
  }
  return args;
}

const USAGE = `undraw — search unDraw and save SVGs into your project

Illustrations (undraw.co) — scenes: heroes, empty states, 404s
  node undraw.mjs search "<query>" [--limit 8] [--json]
  node undraw.mjs get "<media-url>" [--out <path>] [--color "#3b82f6"]

Handcrafts (handcrafts.undraw.co) — accents: arrows, underlines, doodles
  node undraw.mjs handcrafts search "<query>" [--limit 8] [--json]
  node undraw.mjs handcrafts get <id> [--out <path>] [--color <c>] [--style bold|thin]

Pass the \`media\` URL from search output to \`get\` verbatim — CDN paths are not
derivable from slugs.
`;

async function main() {
  // Each case parses its own tail. A single parse up here would force a
  // sub-command group to read its positionals at shifted indices, so its
  // handlers would see a different `args` shape than the top-level ones.
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'search':
      return cmdSearch(parseArgs(rest));
    case 'get':
      return cmdGet(parseArgs(rest));
    case 'handcrafts':
      return cmdHandcrafts(rest); // peels its own sub-command
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(USAGE);
      return;
    default:
      throw new CliError(`Unknown command "${command}".\n\n${USAGE}`, 1);
  }
}

// Pure helpers, exported so they can be exercised without spawning the CLI.
export {
  normalizeColor,
  recolor,
  attribute,
  assertSvg,
  defaultFilename,
  hslToHex,
  PRIMARY_HEX,
  CURRENT_COLOR,
  findCatalogChunkPaths,
  parseHandcraftsCatalog,
  matchHandcrafts,
  resolveHandcraft,
  titleSlug,
  handcraftFilename,
  attributeHandcraft,
};

/**
 * Is the entry script this same file on disk?
 *
 * Both sides are resolved to a real path before comparing. Node's ESM loader
 * resolves modules through symlinks while `process.argv[1]` keeps whatever path
 * the user typed, so a plain string compare silently fails whenever the plugin
 * is reached through a symlink or junction — which the README's own install
 * instructions tell people to create. The failure mode is a no-op with exit 0,
 * so it has to be a file-identity check, not a string check.
 */
async function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return (await realpath(self)) === (await realpath(entry));
  } catch {
    // `self` is absolute but `entry` may be relative, so the fallback has to
    // resolve it — otherwise the comparison is always false and the CLI goes
    // back to being a silent no-op exactly when realpath is unavailable.
    return self === resolvePath(entry);
  }
}

// Only run the CLI when this file is the entry point, so an `import` of the
// helpers above does not print usage and set an exit code as a side effect.
if (await isEntryPoint()) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = err instanceof CliError ? err.code : 2;
  });
}
