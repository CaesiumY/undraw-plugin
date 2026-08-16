# Manual fallback — no Node available

Use this only when `node --version` failed or reported below v18. Everything the
bundled script does is reproduced here with `curl` (or PowerShell) plus your own
file-writing tool.

## 1. Search

```bash
curl -s "https://undraw.co/api/search?q=login"
```

PowerShell:

```powershell
Invoke-RestMethod "https://undraw.co/api/search?q=login" | ConvertTo-Json -Depth 5
```

If `curl` is also unavailable, fetch the same URL with your web-fetch tool.

The response looks like:

```json
{
  "results": [
    {
      "_id": "...",
      "title": "Biometric Login",
      "newSlug": "biometric-login_v832",
      "media": "https://cdn.undraw.co/illustration/biometric-login_v832.svg"
    }
  ],
  "total": 9,
  "hasMore": false
}
```

For more results add `&offset=<n>`.

Build the preview URL as `https://undraw.co/illustration/<newSlug>` — that form
is stable. **The `media` URL is not derivable**: some entries use
`/illustration/` and others `/illustrations/`. Always copy `media` verbatim.

## 2. Present candidates

Show `title` and the preview URL for each result and let the user choose, exactly
as in the main skill.

## 3. Download the SVG

```bash
curl -s "https://cdn.undraw.co/illustration/biometric-login_v832.svg"
```

PowerShell:

```powershell
Invoke-WebRequest "https://cdn.undraw.co/illustration/biometric-login_v832.svg" |
  Select-Object -ExpandProperty Content
```

## 4. Recolor

Replace every occurrence of the literal `#6c63ff` (case-insensitive) with the
target color. That single token is unDraw's primary color across the whole
library — there is nothing else to change.

Without the script there is nothing to normalize the value for you, so convert
it yourself first. Project stylesheets rarely store hex:

- `--primary: 214 92% 58%` (shadcn/ui bare HSL channels) → convert to hex
- `--primary: oklch(...)` → write it through as-is; `fill="oklch(...)"` is valid
  SVG in current browsers
- `--color-primary: hsl(var(--primary))` → an indirection, follow it first

Skip this step if the user wants the default purple.

## 5. Add attribution

On the root `<svg>` tag, add the two attributes unDraw's own downloader injects:

```
artist="Katerina Limpitsouni" copyright="unDraw"
```

Do not duplicate them if they are already present.

## 6. Save

Write the resulting text with your file-writing tool to the path the user
confirmed. Default filename convention: `undraw_<slug>.svg`.

Report the saved path.
