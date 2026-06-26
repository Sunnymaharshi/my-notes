# Tools

Tooling for authoring and building the notes site. Content lives in `content/notes/<id>/`
as one `index.json` per note (schema: `src/lib/schema.ts`).

## Commands

| Command | What it does |
|---|---|
| `npm run convert -- <file> [flags]` | Parse a notes file → skeleton note JSON (see below). |
| `npm run admin` | Local-only studio (port 5174): visual block editor + import + live preview. |
| `npm run dupes [-- --json]` | Report duplicate outline text / code within and across notes (§7a). |
| `npm run content` | Validate all notes against the schema, emit `public/content/` (drafts excluded). |
| `npm run validate` | Validate only (no output written). |
| `npm run dev` | Dev server; serves notes **live from `content/`** (edit-refresh, drafts shown). |
| `npm run build` | Strict content build + type-check + production bundle. |

## `admin` — local studio

`npm run admin` runs a separate Vite app (`vite.admin.config.ts`, port 5174) that reads and
writes `content/notes/` through a tiny Node API. **Local-only — never built or deployed.**
Three panes: note list · editor (envelope form + block editor) · live preview using the real
site renderer. Saving validates against the same Zod schema as the build before writing
`index.json`. Features: labels tag-input with autocomplete, image upload (copied into the note
folder), per-node ⚠ when text/code is duplicated elsewhere, and **Import** (paste raw notes →
the deterministic parser builds blocks → append or replace). No model is ever called — any AI
help is external, by hand, on the resulting JSON.

## `convert` — notes file → JSON

Deterministic, lossless structural parse: indentation → `outline` tree, ``` fences →
`code` nodes. The container's comment delimiters (`""" """`, `''' '''`, `/* */`) are
stripped; code language comes from the fence (```` ```python ````) or the file extension.
New notes are written with `draft: true`.

```
npm run convert -- path/to/file.py --category python --write
```

Flags: `--write` (save to `content/notes/<id>/`; omit to preview on stdout), `--id`,
`--title`, `--category`, `--append <id>`, `--section "Title"`.

Full procedure (incl. the enrichment stage): `tools/convert/README.md`.

## Migration (existing notes → site)

Bringing your existing notes into the site has its own step-by-step playbook (parse → enrich
→ de-duplicate → publish, with the per-pattern `convert` commands and a checklist):
**[MIGRATION.md](MIGRATION.md)**. Detailed parser behavior + the node mapping cheat sheet:
[`tools/convert/README.md`](tools/convert/README.md).

Mapping rule of thumb: **`category` = the technology (the root); `id` = the note.** A
technology split across files maps either to multiple notes under one category, or to one note
via `--append`. Run `npm run dupes` afterward to catch concepts converted from more than one
file.
