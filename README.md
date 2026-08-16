# undraw

**English** | [한국어](README.ko.md)

Search unDraw's [illustrations](https://undraw.co) and
[handcrafts](https://handcrafts.undraw.co) from your coding agent and save an SVG
straight into your project, recolored to match your theme.

```
> find an illustration for the login page

8 results for "login":
 1. Biometric Login — https://undraw.co/illustration/biometric-login_v832
 2. Secure login    — https://undraw.co/illustration/secure-login_m11a
 ...

> the second one

Found primary color #3b82f6 in tailwind.config.ts. Save to public/illustrations/?

> yep

Saved public/illustrations/undraw_secure-login_m11a.svg
Recolored #6c63ff -> #3b82f6
```

Handcrafts are the small hand-drawn accents — arrows, underlines, circles. They
are drawn in `currentColor`, so leaving the color alone is usually the point:

```
> add a hand-drawn underline under the pricing heading

4 results for "underline":
 1. Underline (id 950) — underline, stress, underscore, emphasis   [bold, thin]
 ...

> the first one, thin

Saved src/components/pricing/icons/undraw_underline_950_thin.svg
Kept currentColor — the artwork inherits the CSS `color` around it.
```

## Quick start

On Claude Code:

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

Then `/plugin install undraw@undraw-plugin` and ask for what you need in plain
language — *"find an illustration for the empty cart state"*, or *"put a
hand-drawn arrow next to the CTA"*. The agent searches, shows you candidates,
reads your theme color out of your stylesheet, and writes the file once you
confirm. Other hosts are covered under [Install](#install).

To see what it does before installing anything, run the bundled CLI from a
clone. Node 18+ is the only prerequisite — there is nothing to build or fetch:

```bash
git clone https://github.com/CaesiumY/undraw-plugin
node undraw-plugin/scripts/undraw.mjs search "login" --limit 5
node undraw-plugin/scripts/undraw.mjs handcrafts search "arrow" --limit 5
```

## Install

### Claude Code

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

Then `/plugin install undraw@undraw-plugin`.

### Codex, Cursor, Copilot, VS Code, Kiro

Ships an [Agent Plugins 1.0](https://agent-plugins.org) manifest
(`plugin.json`), which these hosts consume. Install through your host's plugin
mechanism pointing at this repository.

### Gemini CLI

```bash
gemini extensions install https://github.com/CaesiumY/undraw-plugin
```

### Any host that reads SKILL.md — manual

Clone the repo and link the skills into wherever your agent scans for them
(commonly `.agents/skills/`, `~/.claude/skills/`, `.gemini/skills/`):

```bash
git clone https://github.com/CaesiumY/undraw-plugin
```

```bash
ln -s "$PWD/undraw-plugin/skills/undraw-illustrations" ~/.agents/skills/undraw-illustrations
```

```bash
ln -s "$PWD/undraw-plugin/skills/undraw-handcrafts" ~/.agents/skills/undraw-handcrafts
```

Either can be installed without the other — neither reads the other's files.

Copying instead of linking also works — the skills detect a missing script and
fall back to a no-Node path.

## Requirements

Node 18+ for the fast path. Without it the illustrations skill still works — it
falls back to `curl` (or PowerShell on Windows) and walks the same flow through
the agent, with the color conversion done by hand.

Handcrafts degrades further without Node. That site has no API at all, so the
no-Node path can list the catalog but hands the actual download back to the
website's own button. Install Node if you want handcrafts.

There are no npm dependencies and nothing to build.

## What triggers the skills

You do not invoke anything by name. Asking for artwork is enough, and which of
the two skills answers is decided by what you ask for:

| You say | What happens |
|---|---|
| "find an illustration for the login page" | searches `login` — the subject, not the page purpose |
| "we need art for the 404 page" | searches `404` / `error` |
| "빈 상태에 넣을 그림 찾아줘" | Korean requests trigger the same flow |
| "회원가입 페이지 일러스트" | ditto — the skill's triggers are bilingual |
| "undraw에서 가져와줘" | names the source directly |
| "add a hand-drawn arrow pointing at the CTA" | handcrafts — an accent, not a scene |
| "제목 밑에 손그림 밑줄 넣어줘" | handcrafts, in Korean |

The dividing line is scene versus mark. Hero images, empty states, error pages,
onboarding art and placeholder vectors are **illustrations**. Arrows, underlines,
circles, checkmarks, stars and doodles that point at or emphasize something are
**handcrafts**.

Both route through the same six steps: search → you pick → propose a directory →
propose a color → save → report. Both confirm the path and the color before
writing, and neither picks the artwork for you unless you tell it to.

They are two separate skills rather than one with a branch, because the trigger
is the `description` field: one description covering both intents fires on both
and then has to guess. Handing back a 200-byte arrow when you asked for login
page art is the failure that split avoids.

## What's different

**Your stylesheet's color format is the input format.** Whatever is already
declared — shadcn's bare HSL channels (`214 92% 58%`), Tailwind v4's
`oklch(0.514 0.222 16.935)`, `rgb(49 130 246)` — goes straight to `--color`.
Nothing gets converted by hand.

**Handcrafts keep `currentColor` unless you ask otherwise.** Not converting is
the better default: the mark then inherits the CSS `color` around it and follows
dark mode and hover states for free. The CLI says so on every save, including the
caveat that an `<img src>` or a CSS background cannot inherit and renders it
black.

**CDN URLs are never assembled from slugs.** The catalog is inconsistent about
its path segment, and a single search returns both spellings side by side:

```
1. Biometric Login   → https://cdn.undraw.co/illustration/biometric-login_v832.svg
2. Fingerprint login → https://cdn.undraw.co/illustrations/fingerprint-login_19qv.svg
```

A URL guessed from a slug 404s on much of the library, so the `media` field from
`search` is passed through verbatim.

**Handcraft filenames carry the id, because titles are not unique.** Two catalog
entries are both called `Circled Arrow`. Under the site's own naming both are
`undraw_circled-arrow.svg`, so saving the second into a directory that already
holds the first destroys it silently. Files are `undraw_<title-slug>_<id>.svg`
instead.

**It refuses to overwrite what it cannot replace.** `--out` is a file only when
it ends in `.svg`. Pointed at an existing `hero.png`, it exits 1 instead of
writing SVG text over a raster asset.

**No dependencies, no build, no lock file.** One `.mjs` file on Node 18+.
Without Node the illustrations skill falls back to a `curl`-only path that walks
the same flow — though there you convert the color yourself, and the script's
response and filename checks do not apply.

**It fetches one file at a time, by design.** No bulk download, no local mirror,
no cache on disk, and every saved file carries the same attribution attributes
that unDraw's own downloaders write. [Licensing](#licensing) explains why that
matters.

**Every test pins a real defect.** No runner, no dependencies, no network — each
assertion guards a bug that actually occurred or an oddity that is actually in
the catalog, so a failure is a regression rather than a style disagreement.

## Using the CLI directly

The bundled script is usable on its own:

```bash
node scripts/undraw.mjs search "empty cart" --limit 5
node scripts/undraw.mjs search "empty cart" --json

node scripts/undraw.mjs get "https://cdn.undraw.co/illustration/foo_ab12.svg" \
  --out public/illustrations --color "#3b82f6"
```

Exit codes: `0` success, `1` usage error — including a handcraft name matching
more than one entry, `2` network/HTTP error, or handcrafts.undraw.co's page
bundle changed shape, `3` no results, the asset 404'd, the requested style does
not exist, or the response was not an SVG, `4` could not write the output file.

`--color` takes whatever form your stylesheet already uses — you should not have
to convert anything by hand:

| Input | Result |
|---|---|
| `#3b82f6` | used as-is |
| `214 92% 58%` | shadcn/ui bare HSL channels → converted to hex |
| `hsl(214 92% 58%)` | converted to hex |
| `rgb(49 130 246)` / `rgb(50% 20% 90%)` | converted to hex |
| `oklch(0.514 0.222 16.935)` | written through unchanged (needs a CSS Color 4 renderer) |

Alpha is dropped when an `hsl()` or `rgb()` value is converted to hex — an SVG
`fill` takes the color only — and the output says so. Hex and CSS Color 4 values
are written through as given, alpha included.

`--out` is treated as a file only when it ends in `.svg`; anything else is a
directory and is created if missing. Pointing it at an existing file that is not
a `.svg` is refused rather than silently overwritten — writing SVG text over
`hero.png` is never what was meant.

`--limit` may not exceed 50 — a larger value is rejected rather than clamped —
and a search stops after 20 pages or as soon as a page returns nothing new, so
the loop cannot run away if the API changes shape.

**Pass the `media` URL from `search` verbatim.** CDN paths are not derivable
from slugs — newer illustrations live under `/illustration/` and older ones
under `/illustrations/`, so assembling a URL from a slug 404s on much of the
catalog. `get` accepts `cdn.undraw.co` URLs only; the `preview` URL printed
beside it is a web page, not the asset, and is rejected.

### Handcrafts

```bash
node scripts/undraw.mjs handcrafts search "underline" --limit 5
node scripts/undraw.mjs handcrafts get 950 --out src/components/pricing/icons --style thin
```

**Pass the id, not the title.** Titles are not unique, so a name matching more
than one entry is rejected with exit 1 and a list of the ids rather than resolved
to a guess. A name matching exactly one (`arrow` → `Arrow`) does work.

**`--color` is optional here, and usually best left off** — see *What's
different* above. Pass one only when the file will be used somewhere that cannot
inherit.

`--style` is `bold` (the site's default) or `thin`. Not every entry ships both:
`Sneaker` has only a thin variant. Omitting `--style` falls back to whichever
exists and says so; naming a missing one explicitly is exit 3, because then you
asked for it.

There are no preview URLs — handcrafts.undraw.co is a single page with a modal,
so no per-item link exists. Browse them at <https://handcrafts.undraw.co/app>.

## Tests

```bash
node scripts/undraw.test.mjs
```

No runner, no dependencies, no network. Every assertion pins a defect that was
real at some point, so a failure is a regression rather than a style opinion —
read the case before changing the code it guards.

## Scope

Covered: the [illustration library](https://undraw.co) and
[Handcrafts](https://handcrafts.undraw.co).

unDraw's other two open tools are out of scope because neither has a catalog to
wrap — not merely because neither has an API:

- [Code Videos](https://videos.undraw.co) turns *your own* pasted code snippet
  into an MP4. There are no assets in it at all.
- [Banner cards](https://cards.undraw.co) composes a card around an image *you*
  supply ("click on the card or drag a new image inside"). Its editor bundle
  carries no preset or template list, and its sitemap is two URLs.

**Handcrafts is the fragile one, and worth knowing why before relying on it.**
It has no API; its catalog is a JavaScript array literal inlined into a page
chunk whose filename hash changes on every deploy. That is mitigated rather than
solved:

- the chunk path is discovered at runtime from `/app`, so a new hash costs
  nothing;
- the parser reads fields by key and skips entries it cannot follow, so an extra
  field or a reordering is not fatal;
- if fewer than 20 usable entries come back it stops with exit 2 and a pointer to
  the issue tracker, instead of silently returning a short list;
- the parser is pinned by fixture tests covering the catalog's real oddities — an
  artwork-less placeholder entry, an entry with only one style variant, and two
  entries sharing a title.

A redesign upstream still breaks it. It fails loudly when that happens.

## Licensing

The plugin code in this repository is MIT (see `LICENSE`). **The artwork is
not.** The two libraries have separate licenses and they are not identical —
read both before using this tool: <https://undraw.co/license> and
<https://handcrafts.undraw.co/license>

### Illustrations

unDraw is generous about *using* assets:

> "You can use them for noncommercial and commercial purposes. You do not need
> to ask permission from or provide credit to the creator or unDraw."

But it restricts how they are *acquired*:

> "This license does not include the right to compile assets, vectors or images
> from unDraw to replicate a similar or competing service, in any form or
> distribute the assets in packs or otherwise. This extends to automated and
> non-automated ways to link, embed, scrape, search or download the assets
> included on the website without our consent."

and prohibits AI training use outright:

> "This license explicitly prohibits the use of unDraw assets, vectors, and
> images for training, fine-tuning, or developing artificial intelligence,
> machine learning models, or similar technologies."

Additionally, `undraw.co/robots.txt` names several AI user agents — including
`anthropic-ai` — and disallows `/*.svg$` and `/download/*` for them, under the
heading `# AI Training Protection - only for artwork`.

This tool automates acquisition, which falls within the restricted category. It
is published on the understanding that users fetch individual illustrations for
their own projects — the same thing the website's download button does — and not
to build a mirror or a competing catalog. It does not bulk-download, does not
redistribute assets, and writes into each SVG the same `artist` and `copyright`
attributes that unDraw's own downloader does.

If you need a use beyond that, contact unDraw for consent. If you want
illustrations under an unambiguous open license, look at
[Open Peeps](https://openpeeps.com) (CC0) or
[Humaaans](https://humaaans.com) (CC BY 4.0) instead.

### Handcrafts

The Handcrafts license is worded more strictly than the one above, and the extra
wording lands squarely on this plugin. Its summary says not to

> "replicate unDraw Handcrafts, redistribute the artworks in packs or create
> integrations for it."

and its restriction clause extends to

> "automated and non-automated ways to link, embed, scrape, search, use for
> generative AI training purposes or download the assets included on the website
> and integration without our consent."

Neither "create integrations for it" nor "and integration" appears in the main
library's license. **By that wording this plugin is an integration**, so for
Handcrafts it goes a step further than it does for illustrations. That is stated
here rather than glossed over, because you may reasonably decide it rules the
feature out for you.

It is published on the same understanding as the rest of the tool: a user
fetching one mark for their own project, which is what the site's own Download
button does. Concretely, the handcrafts path

- fetches on demand and writes exactly one file per `get`;
- **never caches or writes the catalog to disk**, deliberately — persisting it
  would be the "compile assets" the license forbids, and the reason is pinned as
  rule 3 in `scripts/undraw.mjs` so it does not get "optimized" back in later;
- preserves the `creator` and `origin` attributes the site's downloader writes;
- is removable on request.

One fact cuts the other way and belongs here too, since the illustrations section
cites `robots.txt` against this tool: `handcrafts.undraw.co/robots.txt` is fully
permissive — `User-agent: *` with an empty `Disallow:` — and unlike `undraw.co`
it does not single out AI agents at all.

Illustrations and handcrafts by
[Katerina Limpitsouni](https://twitter.com/ninaLimpi).
