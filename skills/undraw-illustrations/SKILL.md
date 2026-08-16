---
name: undraw-illustrations
description: >-
  Search undraw.co's illustration library and save an SVG into the project,
  recolored to match the project's theme. Use when the user wants an
  illustration, hero image, empty-state graphic, 404/error page art, onboarding
  artwork, or placeholder vector art — e.g. "find an illustration for the login
  page", "빈 상태에 넣을 그림 찾아줘", "회원가입 페이지 일러스트", "undraw에서 가져와줘".
license: MIT
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
---

# unDraw illustrations

Find an illustration on undraw.co and save it into the project, recolored to the
project's theme.

> For a small hand-drawn accent instead — an arrow, underline, circle or doodle
> that points at something rather than filling a space — use the
> `undraw-handcrafts` skill.

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

Run these as two separate commands (`&&` is a parse error in PowerShell 5.1):

```bash
node --version
```

Then confirm `$UNDRAW` exists using whatever file tool you have.

Node 18+ is required (the script uses the global `fetch`).

**If either check fails** — Node missing or older than 18, or the script not
found because only the skill directory was copied into this host — read
`references/manual-fallback.md` and follow it instead. It covers the whole flow
with `curl` alone. Otherwise do not read that file; the steps below are
sufficient.

## Step 2 — Search

Turn the user's request into 1–3 concrete keywords. undraw.co matches on
illustration titles, so search for the *subject* ("login", "security",
"empty cart"), not the page purpose ("signup form for our SaaS").

```bash
node "$UNDRAW" search "login" --limit 8
```

If nothing matches, try a broader synonym before reporting failure. Exit code 3
means the query returned nothing.

`--limit` is capped at 50, and a search stops after 20 pages or as soon as a
page returns nothing new — so a result count below `--limit` means the catalog
ran out, not that something failed. Quote the query: an unquoted multi-word
argument is rejected rather than silently searched by its first word.

## Step 3 — Let the user pick

Present the results as a numbered list with each title and its **preview URL**.
The terminal cannot render the images, so the URL is how the user actually sees
the illustration — always include it.

```
1. Biometric Login — https://undraw.co/illustration/biometric-login_v832
2. Secure login    — https://undraw.co/illustration/secure-login_m11a
```

Ask which one they want. Do not pick for them unless they explicitly said to.

## Step 4 — Propose a save path

Find which of these the project already has: `public/`, `src/assets/`,
`static/`, `app/assets/`, `assets/`. Use your file-listing tool rather than a
shell command so this works on any host.

Propose the conventional one for the framework in use and **confirm before
writing**. Never invent a new directory without asking.

## Step 5 — Propose a color

Look in the stylesheet first — since Tailwind v4, theme colors live in CSS, and
`tailwind.config.*` often does not exist at all.

Search the project's stylesheets for `--primary`, `--color-primary`, or
`--brand` with your content-search tool. The equivalent POSIX command, if you
prefer the shell:

```bash
grep -rnE "^\s*--(primary|color-primary|brand)\s*:" \
  src/app/globals.css app/globals.css src/styles.css src/index.css 2>/dev/null
```

Where to look, in order:

1. **CSS custom properties** in `globals.css` / `styles.css` / `index.css` /
   `theme.css` — `--primary`, `--color-primary`, `--brand`. Inside a
   `@theme { }` block (Tailwind v4) or `:root { }`.
2. **`tailwind.config.*`** → `theme.colors.primary` — only Tailwind v3 and
   earlier.

The value is often **not** a hex string. Common forms:

| Declared as | Convention |
|---|---|
| `--primary: 214 92% 58%` | shadcn/ui — bare HSL channels, wrapped elsewhere by `hsl(var(--primary))` |
| `--primary: oklch(0.514 0.222 16.935)` | Tailwind v4 default palette |
| `--color-primary: hsl(var(--primary))` | an indirection — follow it to the real value |

Pass whatever you found straight to `--color`; the script converts HSL and RGB
to hex and passes CSS Color 4 functions through. Do not convert by hand.

Show the value you found and confirm before writing. If nothing is found, offer
unDraw's default `#6c63ff` or one of the site's presets:
`#17B8A6` `#38bdf8` `#F50057` `#f59e0b` `#dadada`.

## Step 6 — Save

Pass the `media` URL from the search output **verbatim**:

Keep it on one line — a trailing `\` is not a line continuation in PowerShell:

```bash
node "$UNDRAW" get "https://cdn.undraw.co/illustration/biometric-login_v832.svg" --out public/illustrations --color "#3b82f6"
```

**`--out` is treated as a file only when it ends in `.svg`.** Anything else is a
directory and is created if missing, with the filename derived from the slug. So
`--out public/illustrations/login-hero` makes a *directory* named `login-hero` —
write `login-hero.svg` if you meant a file.

If the user asks to replace an existing non-SVG asset (`hero.png`), the command
refuses with exit 1 rather than overwriting it. Save the SVG alongside and
update the reference in the code instead.

Report the saved path. Two outputs need passing on rather than swallowing:

- `Warning: this illustration contains no #6c63ff` on stderr means the recolor
  matched nothing and the file kept its original colors. Say so; do not report a
  recolor that did not happen.
- Exit code `4` means the download succeeded but the file could not be written
  (permissions, a path collision). Nothing was saved.

If the user is working on a component, offer to wire the file in — but only
after it exists on disk.

## Rules

- **Never build a CDN URL from a slug.** Path segments are inconsistent across
  the catalog (`/illustration/` vs `/illustrations/`); only the `media` field
  from `search` is correct. Assembling URLs 404s on roughly half the library.
- **Confirm the path and color before writing.** Both are guesses until the user
  agrees.
- unDraw's license is permissive about *using* assets but restricts automated
  acquisition — see the Licensing section of the plugin README before adding any
  bulk-download behavior.
