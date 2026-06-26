# Notes Website — Plan

Personal, public, static website for developer notes with strong search, labels, and a
learning-focused UX (quick reference + pre-interview revision). Notes authored once into a
single content repo, rendered as collapsible outlines with derived doc/flashcard views.
See `CLAUDE.md` for the condensed locked decisions.

## 1. Goals
- Quick reference + pre-interview revision (primary).
- Great UI/UX and learning experience, not a plain docs site.
- Easy ongoing authoring; search; labels + search-by-label; inline code & images.
- Future-proof: add interactive features without reformatting notes.

## 2. Content model (canonical: structured JSON block-tree)
Chosen over Markdown/MDX/HTML because content is decoupled from presentation: the same
`body` tree renders as tree / doc / flashcard views, new features = new node type (zero
migration), and content stays queryable. HTML is build output only.

Envelope:
```jsonc
{ "id":"fastapi", "title":"FastAPI", "category":"python",
  "labels":["async","api"], "summary":"...", "difficulty":"intermediate",
  "related":["uvicorn"], "updated":"2026-06-26", "draft":false, "body":[ /* nodes */ ] }
```
Block nodes (v1): `outline {text,children?,note?}` · `code {lang,code,filename?,highlight?}`
· `image {src,alt,caption?}` · `callout {variant,text}` · `table {headers,rows}` ·
`flashcard {q,a}`. `text` is a string now, upgradeable to spans+marks later without
migration. **Rule:** new capability = new `type` + renderer + editor control; never break
existing types. Validated by `src/lib/schema.ts` (Zod) at build, on admin save, on import.

## 3. Authoring (all paths emit schema-valid JSON)
1. **Conversion:** fence code in the source file, run `npm run convert -- <file> --write`
   for a deterministic, lossless structural parse (any size), then enrich the JSON
   (category/labels/summary, promote callouts/tables/flashcards). Procedure:
   `tools/convert/README.md`. Used for bulk migration + ongoing.
2. **Local admin studio** (§7) — `npm run admin`, localhost-only, no DB, never deployed.
3. **Direct file edits** when convenient.

Commit + push → static rebuild + deploy. `public/content/` is gitignored (generated build
output), so the deploy runs `npm run build`, whose `prebuild` hook (`npm run content`)
regenerates the per-note JSON, metadata index, and pre-highlighted search index first — no
generated artifacts live in the repo.

## 4. Site & UX
- Pages: home (search + category grid + label cloud), category (`/python`), note
  (collapsible outline + code + images, metadata sidebar, TOC, view switcher), label
  (`/label/async`).
- Learning UX: Cmd-K palette + `/` search; expand/collapse-all + revision mode; flashcard
  "test me"; star/bookmark (localStorage); dark mode; keyboard nav.

## 5. Stack (pure React SPA — no SEO, so no SSG/SSR)
- **Vite + React + TS**, **React Router**, **CSS Modules** (no Tailwind), **Radix UI**
  primitives, **Framer Motion**, **cmdk**, **MiniSearch**, **Zustand**/context.
- Rendering: client fetches a note's `index.json` at runtime; a React serializer walks
  `body` → components; same tree feeds TreeView/DocView/FlashcardView.
- Content as static JSON fetched on demand (decoupled from the app bundle). `code` nodes
  pre-highlighted at build (no highlighter shipped). Images colocated, lazy-loaded.
- Build step (Node) generates: slim metadata index + MiniSearch index + pre-highlighted code.
- Hosting: any static host + SPA fallback (all routes → `index.html`); production static &
  DB-free.
- Upgrade path (not now): `vite-react-ssg` prebuilds HTML and hydrates the same app if
  first-paint ever becomes a measured problem.

## 6. Performance
- Browser loads only the **opened note** (per-note JSON, lazy by route) — never the whole
  corpus; total content size is irrelevant to load time.
- Slim **metadata index** (`id,title,category,labels,summary`) loads once for lists / search
  / Cmd-K; **MiniSearch index** lazy-loads on first search.
- Route-based code-splitting + prefetch-on-hover; brotli compression. Don't shorten schema
  keys (compression handles repetition). Real budget risk is JS/images, not text JSON.

## 7. Admin (local studio) — locked
Local-only block-based visual editor; the editing surface for the JSON (never hand-edit
raw JSON). Runs on `localhost` only → no DB, no auth, never deployed.
- `npm run admin`: Vite/React UI + tiny Node API reading/writing `content/notes/`.
- Envelope form (category dropdown, **labels tag-input with autocomplete**, related picker)
  + block editor: `outline` with Tab/Shift-Tab indent + drag-reorder, `code` w/ language,
  `image` drag-drop (copies into note folder), `callout`/`table`/`flashcard`.
- **Live preview uses the real site renderer** (one source of truth).
- **Import-from-txt:** paste raw notes → the deterministic parser builds blocks → review/edit
  → save. Any AI help is external (you enrich the JSON by hand); the admin never calls a model.
- Save **validates against the Zod schema** before writing `index.json` (+ images).
- **Duplication flag:** see §7a — implemented (per-node ⚠ from `src/lib/dupes.ts`).

### 7a. Duplication detection (implemented)
Surfaces content that already exists, so duplicates can be removed/merged — most useful
during migration when the same concept is converted from more than one file.
- **What:** normalize each `outline.text` (trim, collapse whitespace, lowercase) and each
  `code` block; build an index `normalized → [{noteId, nodePath}]`; flag any entry that
  appears more than once, **within a note and across notes**.
- **Noise control:** ignore very short/generic lines (min length, plus a stoplist like
  "Overview", "Features"); start with exact matches, add fuzzy/near-duplicate later.
- **Surfaces:** (a) CLI `npm run dupes` (or warnings during `npm run content`) reporting
  duplicate groups with locations; (b) in the admin, a ⚠ on any node whose text/code already
  exists elsewhere, linking to the other note, with quick remove/merge actions.

## 8. Search — custom MiniSearch from JSON (locked)
Search runs on a **prebuilt index** loaded once, never on raw JSON/HTML at query time.
- **Build:** read every note → walk `body` collecting `{nodeId,text}` → one doc per note
  `{id,title,category,labels,summary,content,nodes}` → MiniSearch → `search-index.json`.
- **Weights:** title/summary highest; labels/category high (also facets); outline/callout/
  table/flashcard normal; code low (separate toggleable field); image alt low.
- **Query:** lazy-fetch index → in-memory; fuzzy + prefix type-ahead; facets by label and/or
  category combinable with text; results return note `id` + `nodeId` → deep-link to the
  subtopic and auto-expand (e.g. `/python/fastapi#n3.2`).
- Plus the slim metadata index (loaded upfront) for Cmd-K / lists / label filters.
- Fallback only if index maintenance becomes unwanted: Pagefind (HTML-sourced, page-level).

## 9. Layout
```
content/notes/<id>/index.json   # note (+ colocated *.png)
content/categories.json
src/lib/schema.ts               # Zod schema (single source of truth)
src/components/blocks/          # one renderer per node type
src/components/views/           # TreeView / DocView / FlashcardView
tools/convert/parse.ts          # notes file -> skeleton JSON (npm run convert)
tools/dev/content-plugin.ts     # dev: serve notes live from content/
tools/admin/                    # local-only studio (npm run admin) — API + block editor + preview
src/lib/dupes.ts                # duplication detection (npm run dupes + admin flag)
```
Tooling commands + migration guide: `TOOLS.md`.

## 10. Roadmap
1. ~~**Foundation** — `schema.ts`, content build/validation, Vite+React+TS SPA scaffold,
   `fastapi` note converted, minimal block renderer.~~ **Done.**
2. ~~**Core rendering** — component-per-node block renderer, animated collapsible TreeView +
   revision mode, React Router (Home/Category/Note/Label), Shiki build-time code
   highlighting, images.~~ **Done.**
3. ~~**Search & labels** — MiniSearch (§8) + Cmd-K (cmdk), faceted search-by-label, richer
   label pages.~~ **Done.**
4. ~~**Authoring** — local admin studio (`npm run admin`); import-from-txt (deterministic
   parser) + validate-on-import; duplication detection (§7a) — `npm run dupes` CLI + admin
   flag.~~ **Done.** AI assistance, if any, is external/manual — nothing in the repo or site
   calls a model.
5. ~~**Learning UX** — DocView + FlashcardView, Cmd-K, revision mode, bookmarks, dark mode.~~
   **Done.** NoteView is an Outline/Document/Flashcards view switcher; `FlashcardView` is a
   keyboard-driven study deck (←/→ navigate, Space/Enter flip, `s` shuffle) sourced from
   explicit `flashcard` nodes, falling back to outline `note` pairs; bookmarks persist to
   localStorage (star in the note header + sidebar list); dark/light theme toggle (FOUC-free
   bootstrap in `index.html`, persisted, defaults to system).
6. **Migration** (near project end) — bulk-convert existing repo notes per `TOOLS.md`. One
   `category` per technology; multi-file techs → multiple notes or one merged note
   (`--append`). Fence code in source, convert, review live in dev, enrich, set
   `draft: false`.

## 11. Open items
- Repo name + hosting target (default: single repo on Cloudflare/GitHub Pages).
- Note granularity: per-concept grouped by category (recommended) vs per-technology.
