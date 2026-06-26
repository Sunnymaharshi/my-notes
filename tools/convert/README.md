# Converting a notes file → note JSON

Two-stage workflow: a **script** does the faithful structural parse (lossless, deterministic,
any file size), then an **enrichment pass** (you/admin/AI) adds the judgment. The build
(`npm run content`) is the final gate — output is correct only when it prints `✔`.

**Output:** `content/notes/<id>/index.json` — one note per concept (or per technology if the
source is one big topic). Schema: `src/lib/schema.ts`. Worked example:
`content/notes/fastapi/index.json`.

## Stage 1 — run the parser (structure)

1. In the source file, wrap every code block in ``` fences (optionally ```` ```python ````).
   Everything else stays as your normal indented outline. Files can be `.py` / `.js` /
   `.txt` / etc. — the container's comment delimiters (`""" """`, `''' '''`, `/* */`) are
   stripped automatically.
2. Run: `npm run convert -- path/to/notes.py --category <cat> --write`
   (omit `--write` to preview JSON on stdout; `--id` / `--title` to override).
3. This writes a **`draft: true`** skeleton: indentation → outline tree, fenced blocks →
   `code` nodes, every line preserved. Language is taken from the fence or the file
   extension.

## Stage 2 — enrich (judgment, on the structured JSON)

Edit the generated JSON (or do this in the admin later). Do NOT re-transcribe the raw file.

- Fill the envelope: `category` (from `content/categories.json`), `summary` (one line),
  `labels` (lowercase tags), optional `difficulty` / `related`. Set `draft: false`.
- Promote nodes where it helps: a short clarifier on a leaf → `note`; a comparison/pros-cons
  → `table`; a tip/warning/gotcha → `callout`; a Q&A → `flashcard`; a diagram → `image`
  (file in the note folder, `src: "./x.png"`).
- Optionally split a giant per-technology note into several per-concept notes.

**View while you edit:** run `npm run dev` and open the note. In dev the page is served live
from `content/` — edit the JSON, save, and the browser reloads with your change (no rebuild).
Drafts show with a DRAFT badge. Use AI freely here for labels / restructuring / wording on
the already-structured JSON. When it looks right, run `npm run content` until it prints `✔`
and set `draft: false`.

## Manual / AI conversion reference

If converting by hand or via AI without the parser, follow these same mappings:

1. **Envelope.** Fill: `id` (kebab-case, = folder name), `title`, `category` (must be an id
   from `content/categories.json`), `summary` (one line), `labels` (lowercase tags),
   `updated` (today, `YYYY-MM-DD`), `draft: false`. Optional: `difficulty`
   (`beginner|intermediate|advanced`), `related` (other note ids).
2. **Indentation → tree.** Map the source's indentation directly: every bullet becomes an
   `outline` node; a more-indented bullet goes in the parent's `children`. **Preserve order
   and depth exactly** — do not flatten or reorder.
3. **Short clarifier on a leaf** → put it in the optional `note` field instead of adding a
   child (e.g. `{ "type": "outline", "text": "Field", "note": "min_length=2" }`).
4. **Code** → a `code` node `{ lang, code, filename? }` placed as a child under the topic it
   belongs to. Keep the code verbatim. In JSON, newlines = `\n`, double quotes = `\"`.
5. **Comparison / pros-cons / X-vs-Y** → a `table` node `{ headers, rows }`.
6. **Tip / warning / gotcha aside** → a `callout` node `{ variant, text }`
   (`variant: tip|warning|info|note|gotcha`).
7. **Q&A or "test me" pair** → a `flashcard` node `{ q, a }`.
8. **Image** → an `image` node `{ src, alt }`; put the file in the note folder, `src` is
   relative (`"./diagram.png"`).
9. **Validate:** run `npm run content`. Fix the path-level errors it reports until it prints
   `✔ N note(s) validated`.

## Rules (don't break these)

- Only **restructure** what's in the source — never invent or "improve" content.
- Use **only** the node types below; no new `type` values.
- `outline.children` may hold **any** node (outline / code / callout / table / flashcard /
  image). All other nodes are leaves (no children).
- `id` must equal the folder name and match `^[a-z0-9-]+$`.
- Keep `outline.text` concise — move long examples into `code` / `table` / `callout`.

## Node cheat sheet (mirrors the schema)

```
envelope  { id, title, category, labels[], summary, difficulty?, related?[], updated, draft, body[] }
outline   { type:"outline", text, note?, children?[] }
code      { type:"code", lang, code, filename?, highlight?[] }
image     { type:"image", src, alt, caption? }
callout   { type:"callout", variant:"tip|warning|info|note|gotcha", text }
table     { type:"table", headers[], rows[][] }
flashcard { type:"flashcard", q, a }
```
