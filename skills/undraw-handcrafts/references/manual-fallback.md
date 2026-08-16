# Manual fallback — no Node available

Use this only when `node --version` failed or reported below v18.

**Read this first.** The no-Node path is materially worse here than it is for
illustrations. undraw.co has a JSON search API; handcrafts.undraw.co has no API
at all. Its catalog is a JavaScript array literal inlined into a page bundle
whose filename hash changes on every deploy. You can browse that catalog from a
shell easily enough — step 1 — but pulling one artwork *out* of it by hand is
not worth doing, and step 3 says so plainly.

**Installing Node 18+ is the actual fix.** Suggest it before working around it.

## 1. Find the chunk and list the catalog

The page bundle is discoverable in two steps:

```bash
curl -s https://handcrafts.undraw.co/app | grep -o '/_next/static/chunks/pages/app-[^"]*\.js'
```

```bash
curl -s "https://handcrafts.undraw.co/_next/static/chunks/pages/app-<hash>.js" > chunk.js
```

Then read the whole browsable catalog out of it with one grep:

```bash
grep -o '_id:[0-9]*,title:"[^"]*",keywords:"[^"]*"' chunk.js
```

This works because the metadata fields contain no embedded quotes, so a
non-greedy `[^"]*` cannot run past the end of a value. Roughly 67 lines of a few
hundred bytes total come out — enough to show the user everything there is.

PowerShell:

```powershell
Select-String -Path chunk.js -Pattern '_id:\d+,title:"[^"]*",keywords:"[^"]*"' -AllMatches |
  ForEach-Object { $_.Matches.Value }
```

Entries with `b:""` and `t:""` carry no artwork — skip them. An entry may also
have only one of the two variants (`b` is bold, `t` is thin).

## 2. Present candidates

Show `title`, `keywords` and `_id`. **There is no per-item URL** — do not invent
one. Point the user at <https://handcrafts.undraw.co/app> to see the artwork.

Note that titles repeat: two entries are both "Circled Arrow". Use the `_id`.

## 3. Get the artwork — use the website, not the bundle

Do **not** try to extract the SVG body from `chunk.js` by hand. It is a
single-quoted string, possibly hundreds of kilobytes into a file with no line
breaks, and any slicing mistake produces a truncated SVG that still looks
plausible.

Instead, ask the user to:

1. open <https://handcrafts.undraw.co/app>,
2. find the mark (the site has its own keyword search),
3. click it and press **Download**.

That is one click, and it is exactly the acquisition the license contemplates.
Then do the post-processing below on the downloaded file locally.

## 4. Post-process the downloaded file

The site's own download button already applies all of this, so if the user used
it, verify rather than redo. If you are working from a file that lacks any of
it:

- **Recolor** — replace every `currentColor` with the target color. Leaving it
  alone is usually better: the artwork then inherits the CSS `color` around it.
  Only bake a color in if the file will be used as an `<img src>` or a CSS
  background, neither of which can inherit — those render it black.
- **Attribution** — `creator="Katerina Limpitsouni"` on the root `<svg>`, and
  `origin="undraw"` on the first `<path>`. Note these differ from the
  illustrations' `artist=` / `copyright=`. Do not duplicate an attribute that is
  already there — duplicate attributes are a fatal XML error and the image stops
  rendering entirely.
- **Filename** — `undraw_<title-slug>_<id>.svg`, with `_thin` appended for the
  thin variant. The id prevents the two "Circled Arrow" entries from overwriting
  each other.

## 5. Clean up

**Delete `chunk.js` when you are done, and extract only the one artwork the user
asked for.** unDraw's license forbids compiling its assets; keeping the bundle
around "for next time" is exactly that, and is the reason the bundled script
deliberately has no cache. See the Licensing section of the plugin README.
