---
name: undraw-handcrafts
description: >-
  Search handcrafts.undraw.co's hand-drawn accent library and save an SVG into
  the project. Use when the user wants a small decorative or annotating mark
  rather than a scene: an arrow, underline, circle, checkmark, star, squiggle,
  doodle, sticker or hand-drawn icon to point at, underline or emphasize
  something — e.g. "add a hand-drawn arrow pointing at the CTA", "제목 밑에
  손그림 밑줄 넣어줘", "동그라미 쳐줘", "손그림 화살표", "doodle underline for
  this heading".
license: MIT
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

# unDraw Handcrafts

Find a hand-drawn accent mark on handcrafts.undraw.co and save it into the
project. These are small annotation marks — arrows, underlines, circles,
squiggles — meant to sit *next to* content and point at it.

> For a full scene — hero art, an empty state, 404 art, onboarding illustration —
> use the `undraw-illustrations` skill instead. Handing back a 200-byte arrow
> when someone asked for a login-page illustration is the failure to avoid.

## Locating the script

The bundled CLI is at `scripts/undraw.mjs` in the plugin root — two levels up
from this file. In Claude Code use `${CLAUDE_PLUGIN_ROOT}/scripts/undraw.mjs`.
On other hosts, resolve it relative to this SKILL.md's directory:
`<skill-dir>/../../scripts/undraw.mjs`.

Below it is written as `$UNDRAW`. That is a placeholder in this document, not a
variable that exists in your shell — substitute the real path before running
anything. In PowerShell especially, an unset `$UNDRAW` expands to an empty
string and `node ""` fails with a confusing error.

> Shell snippets below are POSIX. On Windows the host may be PowerShell, where
> `&&`, `grep`, and `2>/dev/null` do not work — prefer your own file-search and
> file-read tools for the inspection steps, and use the shell only to run
> `node`.

## Step 1 — Check the runtime

```bash
node --version
```

Then confirm `$UNDRAW` exists using whatever file tool you have.

Node 18+ is required (the script uses the global `fetch`).

**If either check fails**, read `references/manual-fallback.md`. Be aware the
no-Node path is materially worse here than for illustrations — handcrafts has no
API at all — so that file's first recommendation is to install Node. Otherwise
do not read it; the steps below are sufficient.

## Step 2 — Search

Search for the *mark*, not the intent: "arrow", "underline", "circle", "star",
"check", "squiggle" — not "something to highlight the pricing tier".

```bash
node "$UNDRAW" handcrafts search "arrow" --limit 8
```

The catalog is small — about 66 marks — so a miss is common and usually means
the mark does not exist rather than that the query was wrong. Exit code 3 means
nothing matched.

## Step 3 — Let the user pick

**There is no preview URL.** handcrafts.undraw.co is a single page with a modal,
so no per-item link exists. Do not construct one, and do not adapt the
`undraw.co/illustration/<slug>` pattern from the sibling skill — any such URL is
fabricated and will 404.

Instead, present the results by **title, keywords and id**, and point at
<https://handcrafts.undraw.co/app> as the one place to actually look at them.

```
1. Arrow (id 1) — arrow, pointer, show, place, position   [bold, thin]
2. Fun Arrow (id 600) — fun arrow, pointer, joyful        [bold, thin]
```

Two things to carry through from the search output:

- **The id is the identifier, not the title.** Titles repeat — two entries are
  both called "Circled Arrow". Always pass the id to `get`.
- **Check the `styles:` line before offering a variant.** Not every entry ships
  both; "Sneaker" (id 1359) has only a thin one. Offering `--style bold` there
  walks the user into an error.

Ask which one they want. Do not pick for them unless they explicitly said to.

## Step 4 — Propose a save path

Accents usually belong *next to the component that uses them*, not in a global
illustration folder — they are part of one piece of UI, not a page-level asset.

Look for an existing convention: a co-located `icons/` or `assets/` directory
beside the component, else `public/icons/`, `src/assets/`, `static/`. Use your
file-listing tool rather than a shell command so this works on any host.

Propose one and **confirm before writing**. Never invent a directory without
asking.

## Step 5 — Decide about color — usually pass nothing

Handcrafts are drawn in `currentColor`, so by default they inherit the CSS
`color` of whatever they sit in. That is usually the right answer, and it is
better than a baked color because the mark then follows dark mode and hover
states for free.

Decide like this:

| How it will be used | What to do |
|---|---|
| Inlined into markup next to text | **Omit `--color`.** Set `color` on the parent, or let it inherit. |
| Standalone `<img src="…">` | Pass `--color` — an `<img>` cannot inherit and renders it **black**. |
| CSS `background-image` / `url(…)` | Pass `--color`, same reason. |

If you do need a literal color, find the project's primary the same way the
illustrations skill does: `--primary`, `--color-primary` or `--brand` in
`globals.css` / `styles.css` / `index.css` / `theme.css` (inside `@theme { }`
for Tailwind v4, or `:root { }`), then `tailwind.config.*` → `theme.colors.primary`
for Tailwind v3.

Pass whatever you found straight to `--color` — bare shadcn channels
(`214 92% 58%`), `hsl(...)`, `rgb(...)` and `oklch(...)` are all accepted. Do
not convert by hand.

## Step 6 — Save

Keep it on one line — a trailing `\` is not a line continuation in PowerShell:

```bash
node "$UNDRAW" handcrafts get 1 --out src/components/pricing/icons
```

Flags:

- `--style bold|thin` — bold is the site's default; thin sits better next to
  body text. Omit it and, if that entry has no bold variant, the command falls
  back to thin and says so. Type it explicitly and a missing variant is an
  error (exit 3) instead — because then you asked for it.
- `--color` — optional, see step 5.
- `--out` — **a file only when it ends in `.svg`.** Anything else is a directory
  and is created if missing. So `--out icons/arrow` makes a *directory* named
  `arrow`; write `arrow.svg` if you meant a file.

Files are named `undraw_<title-slug>_<id>.svg` (`_thin` appended for the thin
variant). The id is in there on purpose: without it both "Circled Arrow" entries
would be `undraw_circled-arrow.svg` and the second save would silently overwrite
the first.

Report the saved path, and pass these through rather than swallowing them:

- `Kept currentColor …` — repeat the `<img>`/background caveat to the user if
  the file is not going to be inlined.
- Exit `3` — no such id, or that entry has no variant in the style you named.
- Exit `1` — the name you passed matched more than one entry; the message lists
  the ids. Ask the user which, or re-run with an id.
- Exit `4` — nothing was written (permissions, path collision).

If the user is working on a component, offer to wire the file in — but only
after it exists on disk.

## Rules

- **The id is the only stable identifier.** Titles are not unique.
- **Never invent a per-item URL.** There is no such page; link to
  <https://handcrafts.undraw.co/app> or nothing.
- **The catalog is re-read on every command and never cached to disk.** That is
  deliberate, not an oversight — see rule 3 in `scripts/undraw.mjs`. Do not add
  a cache file, and do not save the downloaded page bundle.
- Handcrafts' license is permissive about *using* the artwork but restrictive
  about acquiring it — read the Licensing section of the plugin README before
  fetching more than the one mark the user asked for.
