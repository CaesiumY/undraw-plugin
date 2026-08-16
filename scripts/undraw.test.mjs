#!/usr/bin/env node
/**
 * Regression tests for undraw.mjs. No dependencies, no test runner:
 *
 *   node scripts/undraw.test.mjs
 *
 * Every assertion here pins a defect that actually shipped at some point during
 * review. Several guard code that looks needlessly convoluted — the ugly
 * comment pattern in ROOT_SVG, the attribute scanner instead of a regex — so
 * read the failure before "simplifying" the thing it protects.
 */

import {
  normalizeColor,
  recolor,
  attribute,
  assertSvg,
  defaultFilename,
  CURRENT_COLOR,
  findCatalogChunkPaths,
  parseHandcraftsCatalog,
  matchHandcrafts,
  resolveHandcraft,
  handcraftFilename,
  attributeHandcraft,
} from './undraw.mjs';

let pass = 0;
let fail = 0;

const eq = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${got}\n        want ${want}`}`);
};
const throws = (label, fn) => {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label} (expected a throw)`);
  } catch {
    pass++;
    console.log(`PASS  ${label} (rejected)`);
  }
};
// Several handcrafts cases assert WHICH error: "no such id" (3) and "you must
// disambiguate" (1) send the caller somewhere different, so `throws` alone
// would pass with the codes swapped.
const throwsCode = (label, code, fn) => {
  try {
    fn();
    eq(`${label} (expected a throw)`, 'no throw', `code ${code}`);
  } catch (err) {
    eq(label, err.code, code);
  }
};
const accepts = (label, svg) => eq(label, (() => {
  try {
    assertSvg(svg, 'test');
    return true;
  } catch {
    return false;
  }
})(), true);

console.log('--- color: percent channels and clamping ---');
// 50% of 255 is 127.5 -> 0x80; reading "50%" as the channel 50 gave #32145a.
eq('rgb(50% 20% 90%)', normalizeColor('rgb(50% 20% 90%)').color, '#8033e6');
eq('rgb(100% 100% 100%)', normalizeColor('rgb(100% 100% 100%)').color, '#ffffff');
eq('rgb(300 0 0) clamps', normalizeColor('rgb(300 0 0)').color, '#ff0000');
eq('rgb(-10 20 30) clamps', normalizeColor('rgb(-10 20 30)').color, '#00141e');
// Pin the VALUE, not the length. `toHex` clamps per channel, so an
// over-saturated input yields a well-formed 7-character hex either way — a
// length check here passes with hslToHex's saturation clamp deleted.
eq('hsl over-saturation clamps to 100%', normalizeColor('hsl(214 200% 58%)').color, '#2986ff');
eq('…which is what 100% gives', normalizeColor('hsl(214 100% 58%)').color, '#2986ff');
eq('under-saturation clamps to 0%', normalizeColor('hsl(214 -50% 58%)').color,
  normalizeColor('hsl(214 0% 58%)').color);

console.log('--- color: hex shapes CSS actually supports ---');
throws('#12345 (5 digits)', () => normalizeColor('#12345'));
throws('#1234567 (7 digits)', () => normalizeColor('#1234567'));
eq('#abc', normalizeColor('#abc').color, '#abc');
eq('#aabbccdd', normalizeColor('#aabbccdd').color, '#aabbccdd');

console.log('--- color: angle units ---');
eq('shadcn bare HSL', normalizeColor('214 92% 58%').color, '#3187f6');
eq('0.5turn', normalizeColor('hsl(0.5turn 100% 50%)').color, '#00ffff');
// "200grad" also ends in "rad" — the grad branch has to be tested first.
eq('200grad', normalizeColor('hsl(200grad 100% 50%)').color, '#00ffff');
throws('unknown unit hsl(5px …)', () => normalizeColor('hsl(5px 100% 50%)'));
eq('alpha is reported, not silently dropped',
  normalizeColor('hsla(214 92% 58% / 0.5)').note.includes('alpha dropped'), true);

console.log('--- color: CSS Color 4 passthrough ---');
eq('oklch kept verbatim', normalizeColor('oklch(0.5 0.2 17)').color, 'oklch(0.5 0.2 17)');
throws('body with replacement-pattern chars', () => normalizeColor("lab($' 0 0)"));

console.log('--- recolor: counts, and $& is inert ---');
eq('counts both cases', recolor('<svg fill="#6c63ff" a="#6C63FF"/>', '#000').count, 2);
eq('reports zero rather than lying', recolor('<svg fill="#111111"/>', '#000').count, 0);
eq('$& not interpreted', recolor('<svg fill="#6c63ff"/>', "lab($' 0 0)").svg.includes("lab($' 0 0)"), true);
// Replacing the first 6 digits of #6c63ffAA would strand "AA" after the new
// value — harmless-looking for a hex target, broken SVG for `oklch(…)80`.
eq('8-digit hex left alone', recolor('<svg fill="#6c63ff80"/>', 'oklch(0.5 0.2 17)').count, 0);
eq('8-digit hex unchanged in output',
  recolor('<svg fill="#6c63ff80"/>', '#000').svg, '<svg fill="#6c63ff80"/>');

console.log('--- assertSvg: root element, not "contains <svg" ---');
throws('plain HTML', () => assertSvg('<html><body>404 Not Found</body></html>', 'test'));
// Proxy and CDN error pages routinely embed a logo as inline SVG.
throws('HTML error page with an inline logo', () => assertSvg(
  '<!DOCTYPE html><html><head><title>502</title></head>'
  + '<body><svg viewBox="0 0 24 24"><path d="M0 0"/></svg><h1>502</h1></body></html>', 'test'));
throws('<svgfoo>', () => assertSvg('<svgfoo/>', 'test'));
throws('namespaced root <svg:svg>', () => assertSvg('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>', 'test'));
accepts('plain root', '<svg xmlns="http://www.w3.org/2000/svg"/>');
accepts('XML declaration', '<?xml version="1.0"?><svg width="1"/>');
accepts('leading comment', '<!-- generated --><svg width="1"/>');
accepts('newline after the token', '<svg\n  width="1"/>');
accepts('internal-subset DOCTYPE', '<!DOCTYPE svg [ <!ENTITY n "x"> ]><svg/>');
accepts('SVG 1.1 PUBLIC DOCTYPE',
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>');

console.log('--- assertSvg: backtracking budget on the FAILING path ---');
// A lazy `[\s\S]*?` comment body can run past its own `-->`, giving K sibling
// comments 2^(K-1) ways to split. Measuring a MATCHING input hides this
// completely — the input below must not match.
{
  const t0 = process.hrtime.bigint();
  try {
    assertSvg(`${'<!-- -->'.repeat(2000)}x`, 'test');
  } catch {
    /* expected */
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  eq(`2000 sibling comments, no root (${ms.toFixed(2)}ms) stays under 50ms`, ms < 50, true);
}

console.log('--- attribute: inserts without rewriting the tag ---');
eq('> inside an attribute value', attribute('<svg data-x="a>b" width="10">'),
  '<svg artist="Katerina Limpitsouni" copyright="unDraw" data-x="a>b" width="10">');
// Rewriting the tag lowercased it, so </SVG> no longer matched in XML.
eq('uppercase tag preserved', attribute('<SVG WIDTH="1"></SVG>'),
  '<SVG artist="Katerina Limpitsouni" copyright="unDraw" WIDTH="1"></SVG>');
eq('self-closing', attribute('<svg/>'), '<svg artist="Katerina Limpitsouni" copyright="unDraw"/>');
eq('a comment containing <svg does not capture the insertion',
  attribute('<!-- <svg> from generator --><svg width="1"/>'),
  '<!-- <svg> from generator --><svg artist="Katerina Limpitsouni" copyright="unDraw" width="1"/>');
eq('namespaced root left untouched', attribute('<svg:svg width="1"/>'), '<svg:svg width="1"/>');
eq('idempotent', attribute(attribute('<svg a="1">')), attribute('<svg a="1">'));

console.log('--- attribute: artist detection reads attribute NAMES ---');
const attributed = (svg) => attribute(svg).includes('copyright="unDraw"');
// Each of these fooled a previous regex: `\b` matches inside data-artist, and
// `(?:^|\s)artist=` matches inside a quoted value.
eq('data-artist does not suppress', attributed('<svg data-artist="x" width="1"/>'), true);
eq('xlink:artist does not suppress', attributed('<svg xlink:artist="x" width="1"/>'), true);
eq('artist= inside a value does not suppress', attributed('<svg data-x=" artist=1" width="2"/>'), true);
eq('artist= in a <desc> does not suppress', attributed('<svg width="1"><desc>artist="K"</desc></svg>'), true);
eq('artist= on a child does not suppress', attributed('<svg width="1"><g artist="K"/></svg>'), true);
eq('unquoted value then slash', attributed('<svg width=1/>'), true);
eq('real artist= suppresses', attributed('<svg artist="K" width="1"/>'), false);
eq('single-quoted artist= suppresses', attributed(`<svg artist='K' width='1'/>`), false);
eq('spaced artist = suppresses', attributed('<svg artist = "K"/>'), false);
eq('uppercase ARTIST= suppresses', attributed('<svg ARTIST="K"/>'), false);
eq('valueless artist suppresses', attributed('<svg artist/>'), false);
eq('no duplicate artist attribute',
  (attribute('<svg artist="K" width="1"/>').match(/artist\s*=/gi) || []).length, 1);
// Guarding on `artist` alone appended a second `copyright` here. Note the
// assertion is "unchanged", not "attributed(...) === false": the helper only
// asks whether the OUTPUT contains the attribution, which is true both when we
// added it and when it was already present.
eq('copyright= alone leaves the root untouched',
  attribute('<svg copyright="unDraw" width="1"/>'), '<svg copyright="unDraw" width="1"/>');
eq('no duplicate copyright attribute',
  (attribute('<svg copyright="unDraw" width="1"/>').match(/copyright\s*=/gi) || []).length, 1);

console.log('--- defaultFilename ---');
eq('normal', defaultFilename('https://cdn.undraw.co/illustration/empty_4zx0.svg'), 'undraw_empty_4zx0.svg');
// undraw.co's own downloader strips "_re" globally, which would corrupt this.
eq('_re preserved', defaultFilename('https://cdn.undraw.co/x/book_reading_ab12.svg'), 'undraw_book_reading_ab12.svg');
eq('path traversal', defaultFilename('https://cdn.undraw.co/x/..%2F..%2Fpwned.svg'), 'undraw_pwned.svg');
eq('malformed escape', defaultFilename('https://cdn.undraw.co/x/a%ZZb.svg'), 'undraw_a%ZZb.svg');
// A fixed strip order lets one prefix mask the other.
eq('overlapping prefixes', defaultFilename('https://cdn.undraw.co/x/illustrations-undraw_x.svg'), 'undraw_x.svg');
eq('colon stripped (NTFS ADS)', defaultFilename('https://cdn.undraw.co/x/a%3Ab.svg'), 'undraw_b.svg');
for (const [label, encoded] of [['question mark', '%3F'], ['pipe', '%7C'], ['asterisk', '%2A'], ['quote', '%22']]) {
  eq(`${label} stripped`, /[:*?"<>|]/.test(defaultFilename(`https://cdn.undraw.co/x/a${encoded}b.svg`)), false);
}

// ---------------------------------------------------------------------------
// Handcrafts. Unlike the illustration cases above, several of these pin
// properties of the LIVE catalog rather than defects found in review — the
// empty placeholder, the variant-less entry and the duplicated title are all
// real rows that the first implementation would have mishandled.
// ---------------------------------------------------------------------------

const hcSvg = (d) =>
  `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg">`
  + `<path d="${d}" fill="currentColor"/></svg>`;
const hcItem = (id, title, keywords, b, t) =>
  `{_id:${id},title:"${title}",keywords:"${keywords}",b:'${b}',t:'${t}'}`;
// The drift guard needs 20 usable items, so every fixture carries filler and
// appends the case under test.
const hcFiller = Array.from({ length: 20 }, (_, n) =>
  hcItem(n + 1, `Filler ${n + 1}`, `filler, f${n + 1}`, hcSvg('M0 0'), hcSvg('M1 1')));
const hcChunk = (...extra) => `var _=[${[...hcFiller, ...extra].join(',')}],T=t(7621);`;
const hcParse = (...extra) => parseHandcraftsCatalog(hcChunk(...extra));

console.log('--- handcrafts: catalog parser ---');
{
  // The three real anomalies, verbatim in shape. 1800 is double-quoted empty on
  // the live site; 1359 has no bold; 1375 and 1675 share a title.
  const catalog = hcParse(
    '{_id:1800,title:"Circled X",keywords:"close, delete",b:"",t:""}',
    hcItem(1359, 'Sneaker', 'shoe, sneaker', '', hcSvg('M2 2')),
    hcItem(1375, 'Circled Arrow', 'arrow, circled, loop', hcSvg('M3 3'), hcSvg('M4 4')),
    hcItem(1675, 'Circled Arrow', 'arrow, redo, again', hcSvg('M5 5'), hcSvg('M6 6')),
  );
  const byId = (id) => catalog.find((item) => item.id === id);

  eq('parses every usable entry', catalog.length, 23);
  // A zero-byte placeholder reaching the numbered list means the user picks a
  // number and saves an empty file, so it has to be dropped at parse time.
  eq('empty-body placeholder dropped (1800)', byId(1800), undefined);
  // …but one empty variant is normal, and must not disqualify the entry.
  eq('variant-less entry kept (1359)', byId(1359)?.title, 'Sneaker');
  eq('…with the missing side empty', byId(1359).styles.bold, '');
  eq('…and the present side intact', byId(1359).styles.thin.includes('M2 2'), true);
  // Keying the catalog by title anywhere silently loses one of these.
  eq('duplicate titles both survive', catalog.filter((i) => i.title === 'Circled Arrow').length, 2);
  eq('…and stay distinct', byId(1375).styles.bold.includes('M3 3'), true);
}
{
  // Fields are read by key, so everything after the leading `_id` may reorder.
  // (`_id` itself must stay first — see parseHandcraftsCatalog for why chasing
  // that last assumption would make the parser less safe, not more.)
  const reordered = `{_id:77,t:'${hcSvg('M9 9')}',keywords:"z",title:"Reordered",b:'${hcSvg('M8 8')}'}`;
  const item = hcParse(reordered).find((i) => i.id === 77);
  eq('key order after _id does not matter', item?.title, 'Reordered');
  eq('…values still land on the right keys', item.styles.bold.includes('M8 8'), true);
  // A moved `_id` is a safe failure, not a corrupt parse: the entry is skipped
  // and the drift guard reports it rather than half-reading the object.
  throwsCode('_id moved off the front reads as drift', 2, () =>
    parseHandcraftsCatalog(`var _=[{title:"Moved",_id:78,keywords:"z",b:'${hcSvg('M0 0')}'}]`));
}
{
  // The anchor regex matches inside string VALUES too. Resuming at the object's
  // end rather than just past the anchor is what stops a phantom entry — and is
  // also what keeps the scan linear.
  // The planted id must not collide with the filler's 1..20.
  const trap = hcItem(2000, 'Trap', 'trap {_id:9005} inside a value', hcSvg('M0 0'), hcSvg('M0 0'));
  const catalog = hcParse(trap);
  eq('no phantom item from a string value', catalog.some((i) => i.id === 9005), false);
  eq('…and the real entry survives', catalog.some((i) => i.id === 2000), true);
}
{
  // A truncated tail is what a mid-deploy fetch or a size cap actually looks
  // like. Everything read before it must still be usable.
  const truncated = `${hcChunk()},{_id:99,title:"Cut off",keywords:"x",b:'<svg`;
  eq('truncated final object does not lose the rest', parseHandcraftsCatalog(truncated).length, 20);
}
// Exit 3 would tell the caller "try a broader term", which is wrong advice when
// the remote bundle changed shape and no query can help.
throwsCode('too few items reads as drift, not as no-results', 2, () =>
  parseHandcraftsCatalog(`var _=[${hcItem(1, 'Only', 'one', hcSvg('M0 0'), hcSvg('M0 0'))}]`));
throwsCode('a chunk with no catalog at all', 2, () => parseHandcraftsCatalog('var x=1;'));
{
  // Re-reading every object from each anchor nested inside it is O(n²); 20 000
  // unclosed anchors is where that shows up. A parseable input hides it.
  const t0 = process.hrtime.bigint();
  try {
    parseHandcraftsCatalog('{_id:1,'.repeat(20000));
  } catch {
    /* drift, expected */
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  eq(`20000 unclosed anchors (${ms.toFixed(2)}ms) stays under 200ms`, ms < 200, true);
}

console.log('--- handcrafts: chunk discovery ---');
eq('script src', findCatalogChunkPaths(
  '<script src="/_next/static/chunks/pages/app-375988813d7335f1.js" defer></script>')[0],
  '/_next/static/chunks/pages/app-375988813d7335f1.js');
// Next emits the same chunk both ways; matching only `src` finds nothing the
// day that build setting changes.
eq('preload href is found too', findCatalogChunkPaths(
  '<link rel="preload" href="/_next/static/chunks/pages/app-abc123.js" as="script"/>').length, 1);
eq('the two forms of one path dedupe', findCatalogChunkPaths(
  '<link href="/_next/static/chunks/pages/app-abc123.js"/>'
  + '<script src="/_next/static/chunks/pages/app-abc123.js"></script>').length, 1);
{
  // The required leading slash is what rejects this; without it the plugin
  // would fetch and parse a chunk chosen by whoever controls the page.
  const mixed = findCatalogChunkPaths(
    '<script src="https://evil.example/_next/static/chunks/pages/app-x.js"></script>'
    + '<script src="/_next/static/chunks/pages/app-real.js"></script>');
  eq('absolute cross-origin URL is not returned', mixed.join(), '/_next/static/chunks/pages/app-real.js');
}
eq('no chunk at all', findCatalogChunkPaths('<html></html>').length, 0);

console.log('--- handcrafts: recolor targets currentColor ---');
eq('replaces currentColor', recolor('<svg fill="currentColor"/>', '#3b82f6', CURRENT_COLOR).count, 1);
eq('…and writes the color in',
  recolor('<svg fill="currentColor"/>', '#3b82f6', CURRENT_COLOR).svg.includes('#3b82f6'), true);
// CSS keywords are case-insensitive, so the site could emit either.
eq('case-insensitive', recolor('<svg fill="CurrentColor"/>', '#000', CURRENT_COLOR).count, 1);
// `(?![\w-])`. The hex token's `(?![0-9a-f])` guard is meaningless here and
// would let this through as `#000ish`.
eq('currentColorish untouched', recolor('<svg id="currentColorish"/>', '#000', CURRENT_COLOR).count, 0);
eq('absent token reports zero', recolor('<svg fill="#111"/>', '#000', CURRENT_COLOR).count, 0);
// The two token schemes must not bleed into each other: a swapped or defaulted
// parameter shows up exactly here and nowhere else.
eq('the 2-arg form never touches currentColor', recolor('<svg fill="currentColor"/>', '#000').count, 0);
eq("$' still inert with the new token",
  recolor('<svg fill="currentColor"/>', "lab($' 0 0)", CURRENT_COLOR).svg.includes("lab($' 0 0)"), true);

console.log('--- handcrafts: creator/origin attribution ---');
eq('root gets creator, first path gets origin',
  attributeHandcraft('<svg><path d="M0 0"/></svg>'),
  '<svg creator="Katerina Limpitsouni"><path origin="undraw" d="M0 0"/></svg>');
// Duplicate attributes are a fatal XML error — the image stops rendering.
eq('idempotent', attributeHandcraft(attributeHandcraft('<svg><path d="M0 0"/></svg>')),
  attributeHandcraft('<svg><path d="M0 0"/></svg>'));
// Independent guards: an early return on the root would strand the path.
eq('existing creator still lets origin reach the path',
  attributeHandcraft('<svg creator="x"><path d="M0 0"/></svg>').includes('origin="undraw"'), true);
eq('existing origin on the first path suppresses only that',
  (attributeHandcraft('<svg><path origin="undraw"/></svg>').match(/origin=/g) || []).length, 1);
// The attribute-NAME scanner earns its keep here the same way it does above.
eq('data-origin does not suppress',
  attributeHandcraft('<svg><path data-origin="x"/></svg>').includes('origin="undraw"'), true);
// `(?=[\s/>])`, not `\b`.
eq('<pathological> is not a path',
  attributeHandcraft('<svg><pathological d="1"/></svg>').includes('origin='), false);
// Eight live entries wrap their paths in a <g>, so document-order-at-any-depth
// is the real requirement, not "first child".
eq('nested path is found', attributeHandcraft('<svg><g><path d="M0 0"/></g></svg>'),
  '<svg creator="Katerina Limpitsouni"><g><path origin="undraw" d="M0 0"/></g></svg>');
eq('a commented-out path is skipped',
  attributeHandcraft('<svg><!-- <path/> --><path d="M0 0"/></svg>').includes('<!-- <path/> -->'), true);
eq('no path at all still attributes the root',
  attributeHandcraft('<svg><circle r="1"/></svg>'),
  '<svg creator="Katerina Limpitsouni"><circle r="1"/></svg>');
// The two libraries write different attribute sets; sharing injectAttributes
// must not let either leak into the other.
eq('handcraft attribution adds no artist=',
  attributeHandcraft('<svg><path/></svg>').includes('artist='), false);
eq('illustration attribution adds no origin=',
  attribute('<svg><path/></svg>').includes('origin='), false);

console.log('--- handcrafts: filenames ---');
// This assertion is the entire justification for putting the id in the name.
// Without it both live "Circled Arrow" entries are undraw_circled-arrow.svg and
// the second save destroys the first, printing only `Saved …`.
eq('duplicate titles get different names',
  handcraftFilename('Circled Arrow', 1375, 'bold') === handcraftFilename('Circled Arrow', 1675, 'bold'),
  false);
eq('bold', handcraftFilename('Circled Arrow', 1375, 'bold'), 'undraw_circled-arrow_1375.svg');
eq('thin is suffixed', handcraftFilename('Arrow', 1, 'thin'), 'undraw_arrow_1_thin.svg');
// Typing the default explicitly must not change the name.
eq('explicit bold matches the default', handcraftFilename('Arrow', 1, 'bold'), handcraftFilename('Arrow', 1));
// Titles are remote input, exactly like a URL segment.
eq('path traversal', handcraftFilename('../../etc/passwd', 7, 'bold'), 'undraw_passwd_7.svg');
eq('colon (NTFS ADS)', /:/.test(handcraftFilename('a:b', 7, 'bold')), false);
eq('control characters dropped', /[ \n]/.test(handcraftFilename('a b\nc', 7, 'bold')), false);
eq('empty title falls back', handcraftFilename('   ', 7, 'bold'), 'undraw_handcraft_7.svg');
eq('absurd title capped rather than ENAMETOOLONG',
  handcraftFilename('x'.repeat(500), 7, 'bold').length < 80, true);
// Deliberate: an ASCII-only allowlist would collapse this into the fallback.
eq('non-ASCII title survives', handcraftFilename('화살표', 7, 'bold'), 'undraw_화살표_7.svg');

console.log('--- handcrafts: resolving an id or slug ---');
const hcCatalog = hcParse(
  hcItem(1, 'Arrow', 'arrow, pointer', hcSvg('M0 0'), hcSvg('M0 0')),
  hcItem(600, 'Fun Arrow', 'arrow, fun', hcSvg('M0 0'), hcSvg('M0 0')),
  hcItem(1375, 'Circled Arrow', 'arrow, circled', hcSvg('M0 0'), hcSvg('M0 0')),
  hcItem(1675, 'Circled Arrow', 'arrow, redo', hcSvg('M0 0'), hcSvg('M0 0')),
);
eq('by id', resolveHandcraft(hcCatalog, '1375').id, 1375);
// Exact slug equality, not substring — otherwise the commonest word in the
// catalog is permanently ambiguous.
eq('by slug, exactly', resolveHandcraft(hcCatalog, 'arrow').id, 1);
eq('raw title works too', resolveHandcraft(hcCatalog, 'Fun Arrow').id, 600);
throwsCode('ambiguous slug asks rather than guessing', 1, () => resolveHandcraft(hcCatalog, 'circled-arrow'));
{
  // Naming only one candidate leaves the user with no way to choose.
  let message = '';
  try {
    resolveHandcraft(hcCatalog, 'Circled Arrow');
  } catch (err) {
    message = err.message;
  }
  eq('…and lists every candidate id', message.includes('1375') && message.includes('1675'), true);
}
// No fall-through to slug matching: a mistyped id must not resolve to a title.
throwsCode('unknown id', 3, () => resolveHandcraft(hcCatalog, '9999'));
throwsCode('unknown slug', 3, () => resolveHandcraft(hcCatalog, 'nope'));

console.log('--- handcrafts: search ---');
{
  const catalog = hcParse(
    hcItem(1, 'Arrow', 'pointer, show, spot', hcSvg('M0 0'), hcSvg('M0 0')),
    hcItem(600, 'Fun Arrow', 'squiggle, playful', hcSvg('M0 0'), hcSvg('M0 0')),
    hcItem(1375, 'Circled Arrow', 'redo, again', hcSvg('M0 0'), hcSvg('M0 0')),
    hcItem(1675, 'Circled Arrow', 'loop, repeat', hcSvg('M0 0'), hcSvg('M0 0')),
    hcItem(1900, 'Squiggle', 'arrow, wavy', hcSvg('M0 0'), hcSvg('M0 0')),
    '{_id:1800,title:"Circled X",keywords:"arrow, close",b:"",t:""}',
  );
  const ids = (q, limit = 8) => matchHandcrafts(catalog, q, limit).map((item) => item.id).join(',');

  // undraw's own filter reads keywords only, so "Arrow" — whose keywords never
  // say "arrow" — would be unfindable by its own name.
  eq('matches a title the keywords do not mention', ids('arrow').includes('1'), true);
  eq('…and a keyword the title does not mention', ids('arrow').includes('1900'), true);
  // Keywords are comma-space delimited, so a whole-string substring test never
  // finds this pair.
  eq('multi-word query is tokenized', ids('circled arrow'), '1375,1675');
  // The user answers "2번" against this list; equal scores must not reshuffle.
  eq('deterministic order, exact title first', ids('arrow'), '1,600,1375,1675,1900');
  eq('limit respected', matchHandcrafts(catalog, 'arrow', 2).length, 2);
  eq('case-insensitive', ids('ARROW'), ids('arrow'));
  // The placeholder must not be offered here either — this is where a user
  // would actually see it.
  eq('empty-body placeholder never listed', ids('arrow').includes('1800'), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
