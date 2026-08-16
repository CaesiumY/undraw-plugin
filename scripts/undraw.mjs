#!/usr/bin/env node
/**
 * undraw.mjs — zero-dependency CLI for undraw.co illustrations.
 *
 * Requires Node 18+ (uses the global `fetch`). No npm install, no package.json.
 *
 * Usage:
 *   node undraw.mjs search "<query>" [--limit 8] [--json]
 *   node undraw.mjs get "<media-url>" --out <path> [--color "#3b82f6"]
 *
 * Exit codes:
 *   0  success
 *   1  usage error (bad/missing arguments)
 *   2  network or HTTP error
 *   3  no results / asset not found / response was not an SVG
 *   4  could not write the output file
 */

import { realpath } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.3.0';
const UA = `undraw-plugin/${VERSION} (+https://github.com/CaesiumY/undraw-plugin)`;

/** unDraw's default primary color, baked as a literal into every SVG. */
const DEFAULT_PRIMARY = '#6c63ff';

/** Attribution attributes undraw.co injects into its own downloads. */
const ATTRIBUTION = 'artist="Katerina Limpitsouni" copyright="unDraw"';

/** Local bounds on the search loop, so termination never depends on the remote API. */
const MAX_PAGES = 20;
const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Two rules that look like cleanup opportunities but are not. Do not "fix".
//
//  1. NEVER build a CDN URL from a slug. The path segment is inconsistent
//     across the catalog: newer entries live under /illustration/ (singular),
//     older ones under /illustrations/ (plural). Only the `media` field
//     returned by the API knows which. Assembling URLs 404s on half the set.
//
//  2. NEVER use /_next/data/<buildId>/... endpoints. `buildId` changes on
//     every undraw.co deploy, so those paths rot within days. /api/search and
//     /api/sitemap are the stable surfaces.
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

async function getText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch (cause) {
    throw new CliError(`Network request failed: ${url}\n  ${cause.message}`, 2);
  }
  if (res.status === 404) {
    throw new CliError(`Asset not found (404): ${url}`, 3);
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
  // Split on every character Windows forbids in a filename, not just the path
  // separators: a `:` creates an NTFS alternate data stream rather than the
  // file you asked for, and `? | " * < >` fail the write outright.
  let base = decoded.split(/[/\\:*?"<>|]/).pop().replace(/\.svg$/i, '');
  // Loop rather than chain: a fixed order lets one prefix mask the other, so
  // "illustrations-undraw_x" would come out as "undraw_undraw_x".
  let previous;
  do {
    previous = base;
    base = base.replace(/^illustrations-/, '').replace(/^undraw_/, '');
  } while (base !== previous);
  base = base.replace(/^\.+/, '');
  return `undraw_${base || 'illustration'}.svg`;
}

/**
 * Replace unDraw's literal primary color. The site emits it lowercase; we accept
 * either case. Returns the count so the caller can avoid claiming a recolor that
 * never happened.
 */
function recolor(svg, color) {
  let count = 0;
  // Function replacer, not a string: `$&` and friends are special in a string
  // replacement and would corrupt colors like `lab($' 0 0)`.
  // `(?![0-9a-f])` keeps the match off the first half of an 8-digit
  // #6c63ffAA: replacing only the leading 6 digits would strand the alpha pair
  // after the new value, which is merely odd for a hex target but produces
  // `oklch(…)80` — broken SVG — for a CSS Color 4 one.
  const out = svg.replace(new RegExp(`${DEFAULT_PRIMARY}(?![0-9a-f])`, 'gi'), () => {
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
 * Lowercased attribute NAMES on the root tag, scanning from just after `<svg`.
 *
 * This is a scanner rather than a regex on purpose. Attribute names are only
 * distinguishable from attribute *values* by tracking quoting, and every regex
 * approximation of "does the root carry artist=" has a hole: `\bartist=` also
 * matches `data-artist=`, and `(?:^|\s)artist=` also matches a value such as
 * `data-x=" artist=1"`. Both suppress the attribution silently.
 *
 * Tolerant of malformed input by design — it stops at the tag's end, at the
 * end of the string, and treats unquoted values as running to whitespace.
 */
function rootAttributeNames(svg, from) {
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

/** Reject anything that is not actually an SVG before it is written as one. */
function assertSvg(text, url) {
  if (!ROOT_SVG.test(text)) {
    const head = text.slice(0, 60).replace(/\s+/g, ' ').trim();
    throw new CliError(`Response from ${url} is not an SVG (starts with "${head}").`, 3);
  }
}

/**
 * Add unDraw's attribution attributes. Idempotent.
 *
 * The attributes are inserted right after the `<svg` token rather than by
 * rewriting the whole opening tag: rewriting lowercases `<SVG>` (breaking the
 * case-sensitive XML match with `</SVG>`) and mangles roots whose attribute
 * values contain a `>`.
 */
function attribute(svg) {
  const match = svg.match(ROOT_SVG);
  if (!match) return svg;
  const afterToken = match[0].length;
  // Look for an existing artist= in the ROOT TAG only. Scanning the whole
  // document cuts both ways: a <desc> that merely mentions the artist would
  // suppress the real attribution, while a root that already uses single
  // quotes would get a second artist= — and duplicate attributes are a fatal
  // XML error, so the image stops rendering entirely.
  // Either attribute means the root is already attributed. Checking only
  // `artist` would append a second `copyright`, and duplicate attributes are a
  // fatal XML error — the same failure this function exists to avoid.
  const names = rootAttributeNames(svg, afterToken);
  if (names.has('artist') || names.has('copyright')) return svg;
  return `${svg.slice(0, afterToken)} ${ATTRIBUTION}${svg.slice(afterToken)}`;
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

  const rawLimit = args.limit ?? '8';
  if (typeof rawLimit !== 'string' || !/^[1-9]\d*$/.test(rawLimit)) {
    throw new CliError(`--limit must be a positive integer, got "${rawLimit}"`, 1);
  }
  const limit = Number.parseInt(rawLimit, 10);
  if (limit > MAX_LIMIT) {
    throw new CliError(`--limit is capped at ${MAX_LIMIT}, got ${limit}.`, 1);
  }

  const results = await search(query, limit);
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
  if (args.out !== undefined && typeof args.out !== 'string') {
    throw new CliError('--out needs a path, e.g. --out public/illustrations', 1);
  }
  // Validate everything cheap before spending a request.
  const color = args.color ? normalizeColor(args.color) : null;

  const { writeFile, mkdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');

  const filename = defaultFilename(mediaUrl);
  let outPath = args.out ?? filename;
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
  if (isDir) outPath = path.join(outPath, filename);

  // Everything above is decidable without the network, so a usage error costs
  // no request and reports exit 1 rather than being masked by a transport
  // failure that happened to come first.
  let svg = await getText(mediaUrl);
  assertSvg(svg, mediaUrl);

  let replaced = 0;
  if (color) ({ svg, count: replaced } = recolor(svg, color.color));
  svg = attribute(svg);

  try {
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, svg, 'utf8');
  } catch (cause) {
    throw new CliError(`Could not write ${outPath}\n  ${cause.message}`, 4);
  }

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

const USAGE = `undraw — search undraw.co and save illustrations

  node undraw.mjs search "<query>" [--limit 8] [--json]
  node undraw.mjs get "<media-url>" [--out <path>] [--color "#3b82f6"]

Pass the \`media\` URL from search output to \`get\` verbatim — CDN paths are not
derivable from slugs.
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case 'search':
      return cmdSearch(args);
    case 'get':
      return cmdGet(args);
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
export { normalizeColor, recolor, attribute, assertSvg, defaultFilename, hslToHex };

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
