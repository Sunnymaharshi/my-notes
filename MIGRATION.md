# Migration guide — existing notes → the site

How to bring your existing indented-outline notes (e.g. `fastapi-notes.py`) into this site as
schema-valid note JSON. Do it **one technology at a time**, near the end of the project.

The workflow is two stages: a **deterministic parser** does the faithful structural parse
(lossless, any file size), then **you enrich** the resulting JSON (labels, summary, callouts,
splitting). The build (`npm run content`) is the final gate — content is correct only when it
prints `✔`. **No AI runs in the repo or the site**; if you use AI to help enrich, do it
externally, by hand, on the already-structured JSON.

> Detailed parser behavior + the full node mapping cheat sheet live in
> [`tools/convert/README.md`](tools/convert/README.md). This file is the practical playbook.

---

## Key decisions before you start

- **`category` = the technology (the root); `id` = the note.** Categories are an enum in
  `content/categories.json` — add the ones you need first.
- **Granularity** — pick per technology:
  - *Per concept* (recommended): several focused notes under one category.
  - *Per technology*: one big note for the whole topic.
  - A technology split across several source files can become **multiple notes** (same
    `--category`) or **one merged note** (via `--append`).

---

## Stage 1 — parse (structure)

1. **Prep the source file.** Wrap every code block in ` ``` ` fences (optionally
   ` ```python `). Everything else stays as your normal indented outline. Files can be
   `.py` / `.js` / `.ts` / `.txt` / etc. — the container's comment delimiters
   (`""" """`, `''' '''`, `/* */`) are stripped automatically, and the code language is taken
   from the fence or the file extension.

2. **Run the converter.** Pick the pattern that matches your case:

   **Single file → one note:**
   ```bash
   npm run convert -- notes/fastapi.py --category python --write
   ```

   **A technology split across files → one merged note** (create from the first file, then
   append the rest as top-level sections):
   ```bash
   npm run convert -- react-core.js   --id react --title React --category react --write
   npm run convert -- react-hooks.js  --append react --section "Hooks"
   npm run convert -- react-router.js --append react --section "Router"
   ```

   **A technology with independent topics → multiple notes** (same category groups them in
   the UI):
   ```bash
   npm run convert -- dsa-arrays.js --category dsa --write
   npm run convert -- dsa-trees.js  --category dsa --write
   ```

   Flags: `--write` (save to `content/notes/<id>/`; omit to preview JSON on stdout), `--id`,
   `--title`, `--category`, `--append <id>`, `--section "Title"`.

   This writes a **`draft: true`** skeleton: indentation → `outline` tree, fenced blocks →
   `code` nodes, every line preserved.

> **Tip:** the admin studio (`npm run admin`) has the same import built in — paste raw notes
> and review the generated blocks side-by-side (source vs JSON, both editable) before
> inserting. Handy for small files or pasting fragments.

---

## Stage 2 — enrich (judgment)

Open the note in the admin (`npm run admin`) or edit the JSON live under `npm run dev` (the
page reloads on save; drafts show a DRAFT badge). **Do not re-transcribe the raw file** — only
restructure what the parser produced.

- **Fill the envelope:** `category` (an id from `content/categories.json`), one-line
  `summary`, lowercase `labels`, optional `difficulty` / `related`.
- **Promote nodes where it helps:**
  - short clarifier on a leaf → its `note` field
  - comparison / pros-cons / X-vs-Y → `table`
  - tip / warning / gotcha aside → `callout`
  - Q&A or "test me" pair → `flashcard` (these power the Flashcards view directly)
  - diagram → `image` (file in the note folder, `src: "./x.png"`)
- **Split** a giant per-technology note into several per-concept notes if it's too big.

---

## Stage 3 — de-duplicate

Converting the same concept from two files produces duplicates — common during migration.

```bash
npm run dupes            # report repeated outline lines / code, within and across notes
npm run dupes -- --json  # machine-readable
```

The admin shows the same ⚠ on each duplicated node so you can remove or merge them.
Detection logic: `src/lib/dupes.ts`.

---

## Stage 4 — publish

1. Set `draft: false` on the note.
2. Run the strict build until it passes:
   ```bash
   npm run content      # validates + emits public/content/; fix path-level errors until ✔
   ```
3. Review the final result in `npm run dev`, then commit. (Drafts are excluded from the
   production build, so anything left `draft: true` simply won't ship.)

---

## Checklist per technology

- [ ] Category exists in `content/categories.json`
- [ ] Granularity decided (per-concept vs per-technology; multi-file → multiple notes or `--append`)
- [ ] Code fenced in the source file(s)
- [ ] Parsed with `npm run convert` (`--write`)
- [ ] Envelope filled (category, summary, labels; difficulty/related as needed)
- [ ] Nodes promoted (notes / tables / callouts / flashcards / images)
- [ ] `npm run dupes` reviewed; duplicates merged/removed
- [ ] `draft: false`
- [ ] `npm run content` prints `✔`
