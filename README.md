# undraw

Search [undraw.co](https://undraw.co)'s illustration library from your coding
agent and save an SVG straight into your project, recolored to match your theme.

```
> 로그인 페이지에 쓸 일러스트 찾아줘

8 results for "login":
 1. Biometric Login — https://undraw.co/illustration/biometric-login_v832
 2. Secure login    — https://undraw.co/illustration/secure-login_m11a
 ...

> 2번으로

Found primary color #3b82f6 in tailwind.config.ts. Save to public/illustrations/?

> ㅇㅇ

Saved public/illustrations/undraw_secure-login_m11a.svg
Recolored #6c63ff -> #3b82f6
```

## Install

### Claude Code — verified

```bash
/plugin marketplace add CaesiumY/undraw-plugin
```

Then `/plugin install undraw@undraw-plugin`.

### Codex, Cursor, Copilot, VS Code, Kiro — unverified

Ships an [Agent Plugins 1.0](https://agent-plugins.org) manifest
(`plugin.json`), which these hosts consume. Install through your host's plugin
mechanism pointing at this repository.

### Gemini CLI — unverified

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

> **Verification status.** Only Claude Code has been installed and run
> end-to-end. The other manifests are written to spec but untested; reports
> welcome via issues.

## Requirements

Node 18+ for the fast path. Without it the skill still works — it falls back to
`curl` (or PowerShell on Windows) and does the same work through the agent.

There are no npm dependencies and nothing to build.

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
