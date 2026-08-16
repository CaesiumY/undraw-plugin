# undraw

**English** | [한국어](README.ko.md)

Search [undraw.co](https://undraw.co)'s illustration library from your coding
agent and save an SVG straight into your project, recolored to match your theme.

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

## Quick start

On Claude Code:

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

Then `/plugin install undraw@undraw-plugin` and ask for what you need in plain
language — *"find an illustration for the empty cart state"*. The agent
searches, shows you candidates, reads your theme color out of your stylesheet,
and writes the file once you confirm. Other hosts are covered under
[Install](#install).

To see what it does before installing anything, run the bundled CLI from a
clone. There is nothing to install first:

```bash
git clone https://github.com/CaesiumY/undraw-plugin
node undraw-plugin/scripts/undraw.mjs search "login" --limit 5
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

Clone the repo and link the skill into wherever your agent scans for skills
(commonly `.agents/skills/`, `~/.claude/skills/`, `.gemini/skills/`):

```bash
git clone https://github.com/CaesiumY/undraw-plugin
ln -s "$PWD/undraw-plugin/skills/undraw-illustrations" ~/.agents/skills/undraw-illustrations
```

Copying instead of linking also works — the skill detects a missing script and
falls back to a `curl`-only path.

## Requirements

Node 18+ for the fast path. Without it the skill still works — it falls back to
`curl` (or PowerShell on Windows) and does the same work through the agent.

There are no npm dependencies and nothing to build.

## What triggers the skill

You do not invoke anything by name. Asking for artwork is enough:

| You say | What happens |
|---|---|
| "find an illustration for the login page" | searches `login` — the subject, not the page purpose |
| "we need art for the 404 page" | searches `404` / `error` |
| "빈 상태에 넣을 그림 찾아줘" | Korean requests trigger the same flow |
| "회원가입 페이지 일러스트" | ditto — the skill's triggers are bilingual |
| "undraw에서 가져와줘" | names the source directly |

Hero images, empty states, error pages, onboarding art, and placeholder vectors
all route to the same six steps: search → you pick → propose a directory →
propose a color found in your stylesheet → save → report. It confirms the path
and the color before writing, and it never picks the illustration for you unless
you tell it to.

## What's different

**Your stylesheet's color format is the input format.** Whatever is already
declared — shadcn's bare HSL channels (`214 92% 58%`), Tailwind v4's
`oklch(0.514 0.222 16.935)`, `rgb(49 130 246)` — goes straight to `--color`.
Nothing gets converted by hand.

**CDN URLs are never assembled from slugs.** The catalog is inconsistent about
its path segment, and a single search returns both spellings side by side:

```
1. Biometric Login   → https://cdn.undraw.co/illustration/biometric-login_v832.svg
2. Fingerprint login → https://cdn.undraw.co/illustrations/fingerprint-login_19qv.svg
```

A URL guessed from a slug 404s on much of the library, so the `media` field from
`search` is passed through verbatim.

**It refuses to overwrite what it cannot replace.** `--out` is a file only when
it ends in `.svg`. Pointed at an existing `hero.png`, it exits 1 instead of
writing SVG text over a raster asset.

**No dependencies, no build, no lock file.** One `.mjs` file on Node 18+, and
without Node the skill drops to a `curl`-only path that does the same work.

**It fetches one file at a time, by design.** No bulk download, no local mirror,
and the `artist` and `copyright` attributes that unDraw's own downloader writes
are preserved in the output. [Licensing](#licensing) explains why that matters.

**Every test pins a real defect.** No runner, no dependencies, no network — each
assertion guards a bug that actually occurred, so a failure is a regression
rather than a style disagreement.

## Using the CLI directly

The bundled script is usable on its own:

```bash
node scripts/undraw.mjs search "empty cart" --limit 5
node scripts/undraw.mjs search "empty cart" --json

node scripts/undraw.mjs get "https://cdn.undraw.co/illustration/foo_ab12.svg" \
  --out public/illustrations --color "#3b82f6"
```

Exit codes: `0` success, `1` usage error, `2` network/HTTP error, `3` no results
or the response was not an SVG, `4` could not write the output file.

`--color` takes whatever form your stylesheet already uses — you should not have
to convert anything by hand:

| Input | Result |
|---|---|
| `#3b82f6` | used as-is |
| `214 92% 58%` | shadcn/ui bare HSL channels → converted to hex |
| `hsl(214 92% 58%)` | converted to hex |
| `rgb(49 130 246)` / `rgb(50% 20% 90%)` | converted to hex |
| `oklch(0.514 0.222 16.935)` | written through unchanged (needs a CSS Color 4 renderer) |

Alpha channels are dropped (an SVG `fill` takes the color only) and the output
says so.

`--out` is treated as a file only when it ends in `.svg`; anything else is a
directory and is created if missing. Pointing it at an existing file that is not
a `.svg` is refused rather than silently overwritten — writing SVG text over
`hero.png` is never what was meant.

`--limit` is capped at 50, and a search stops after 20 pages or as soon as a
page returns nothing new, so the loop cannot run away if the API changes shape.

**Pass the `media` URL from `search` verbatim.** CDN paths are not derivable
from slugs — newer illustrations live under `/illustration/` and older ones
under `/illustrations/`, so assembling a URL from a slug 404s on much of the
catalog.

## Tests

```bash
node scripts/undraw.test.mjs
```

No runner, no dependencies, no network. Every assertion pins a defect that was
real at some point, so a failure is a regression rather than a style opinion —
read the case before changing the code it guards.

## Scope

v1 covers the main illustration library only.

unDraw's other open tools are [Handcrafts](https://handcrafts.undraw.co),
[Code Videos](https://videos.undraw.co), and
[Banner cards](https://cards.undraw.co). The latter two are browser-only editors
with no read API, so they cannot meaningfully be wrapped. Handcrafts has no
official API either — its SVGs are inlined into a JS bundle whose hash changes
every deploy — so it is a possible but fragile future addition.

## Licensing

The plugin code in this repository is MIT (see `LICENSE`). **The illustrations
are not.** They are governed by unDraw's own license, which you should read
before using this tool: <https://undraw.co/license>

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
redistribute assets, and preserves the `artist` and `copyright` attributes that
unDraw's own downloader writes into each SVG.

If you need a use beyond that, contact unDraw for consent. If you want
illustrations under an unambiguous open license, look at
[Open Peeps](https://openpeeps.com) (CC0) or
[Humaaans](https://humaaans.com) (CC BY 4.0) instead.

Illustrations by [Katerina Limpitsouni](https://twitter.com/ninaLimpi).
