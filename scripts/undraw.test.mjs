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

import { normalizeColor, recolor, attribute, assertSvg, defaultFilename } from './undraw.mjs';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
