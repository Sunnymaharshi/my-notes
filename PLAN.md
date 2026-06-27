# Notes Website — Plan

Personal, public, static site for developer notes: strong search, labels, learning-focused UX
(quick reference + pre-interview revision). Notes authored once into a single content repo,
rendered as collapsible outlines with derived doc/flashcard views. Condensed locked decisions
live in `CLAUDE.md`; this file is the rationale + roadmap.

## 1. Goals
Quick reference + pre-interview revision (primary). Great learning UX, not a plain docs site.
Easy ongoing authoring; search; labels + search-by-label; inline code & images. Future-proof:
add interactive features without reformatting notes.

## 2. Content model (structured JSON block-tree)
Chosen over MD/MDX/HTML: content decoupled from presentation — same `body` tree renders as
tree/doc/flashcard, new features = new node type (zero migration), content stays queryable.
HTML is build output only.

Envelope: `{ id, title, category, labels[], summary, difficulty?, related?[], updated, draft, body[] }`.
Nodes (v1): `outline {text,children?,note?,role?}` · `code {lang,code,filename?,highlight?}` ·
`image {src,alt,caption?}` · `callout {variant,text}` · `table {headers,rows}` · `flashcard {q,a}`.
`text` is a string now, upgradeable to spans+marks later without migration. **Rule:** new
capability = new `type` + renderer + editor control; never break existing types. Validated by
`src/lib/schema.ts` (Zod) at build, admin save, import.

Catalog: **`domains.json`** (frontend/backend/…) → **`categories.json`** (techs, each with a
`domain`) → notes (`category`). `outline.role:"topic"` marks a self-contained showable unit
(deep-link target, see §8). `code.highlight` = 1-based lines emphasized at build by Shiki.

## 3. Authoring (all paths emit schema-valid JSON)
1. **Conversion:** fence code in source, `npm run convert -- <file> --write` for a deterministic
   lossless structural parse (any size; auto-seeds `role:"topic"` on depth 0–1 branches), then
   enrich the JSON (category/labels/summary, promote callouts/tables/flashcards, refine roles).
   Procedure: `tools/convert/README.md`. Used for migration + ongoing.
2. **Admin studio** (§7) — `npm run admin`, localhost-only, no DB, never deployed.
3. **Direct file edits** when convenient.

Commit + push → static rebuild + deploy. `public/content/` is gitignored; deploy runs
`npm run build`, whose `prebuild` (`npm run content`) regenerates per-note JSON, metadata index,
and search index. No generated artifacts in the repo.

## 4. Site & UX
Pages: home (search + category grid + label cloud), category (`/python`), note (collapsible
outline + code + images, metadata, TOC, view switcher), label (`/label/async`). Learning UX:
Cmd-K + `/` search; expand/collapse-all + revision mode; flashcard "test me"; bookmark
(localStorage); dark mode; keyboard nav.

## 5. Stack (pure React SPA — no SEO, so no SSG/SSR)
Vite + React + TS, React Router, CSS Modules (no Tailwind), Radix (tooltip/dialog), Framer Motion,
cmdk, MiniSearch, Zustand/context, IBM Plex via `@fontsource`. UI = the "Field Manual" design
system; all visual tokens (color/type/space/motion) live in `src/index.css`. Client fetches a note's `index.json` at runtime; a React serializer
walks `body` → components; same tree feeds Tree/Doc/Flashcard views. `code` pre-highlighted at
build (no highlighter shipped). Build (Node) generates: slim metadata index + MiniSearch index +
pre-highlighted code. Hosting: any static host + SPA fallback. Upgrade path (not now):
`vite-react-ssg` if first-paint becomes a measured problem.

## 6. Performance
Browser loads only the **opened note** (per-note JSON, lazy by route) — total corpus size is
irrelevant. Slim **metadata index** loads once for lists/search/Cmd-K; **MiniSearch index**
lazy-loads on first search. Route code-splitting + prefetch-on-hover; brotli. Don't shorten
schema keys. Real budget risk is JS/images, not text JSON.

## 7. Admin (local studio) — locked
Local-only block-based visual editor; the editing surface for the JSON (never hand-edit raw JSON).
`localhost` only → no DB, no auth, never deployed. `npm run admin`: Vite/React UI + tiny Node API
over `content/notes/`. Envelope form (category dropdown, labels tag-input w/ autocomplete, related
picker) + block editor (`outline` Tab/Shift-Tab indent + drag-reorder, `code` w/ language, `image`
drag-drop, `callout`/`table`/`flashcard`). **Live preview uses the real site renderer.**
**Import-from-txt:** paste raw notes → deterministic parser → review/edit → save. Save **validates
against Zod** before writing. Any AI help is external/manual; admin never calls a model.

### 7a. Duplication detection (implemented)
Surfaces content that already exists (most useful during migration). Normalize each `outline.text`
(trim/collapse/lowercase) and each `code` block; index `normalized → [{noteId, nodePath}]`; flag
entries appearing >1×, within and across notes. Noise control: ignore short/generic lines + a
stoplist; exact matches first (fuzzy later). Surfaces: (a) `npm run dupes` CLI; (b) admin ⚠ per
node, linking to the other note with remove/merge actions.

## 8. Search — custom MiniSearch from JSON (locked)
Runs on a **prebuilt index** loaded once, never on raw JSON at query time. **Build:** each note →
walk `body` collecting `{nodeId,text}` → one doc per note → MiniSearch → `search-index.json`.
**Weights:** title/summary highest; labels/category high (also facets); outline/callout/table/
flashcard normal; code low (separate toggleable field); image alt low. **Query:** lazy-fetch
index → in-memory; fuzzy + prefix; facets by label/category combinable with text; results return
note `id` + `nodeId` → deep-link (`/python/fastapi#n3.2`). `resolveTopic` climbs the hit to its
nearest `role:"topic"` and renders that topic focused (`TopicView`), flashing the matched line.
Plus the slim metadata index for Cmd-K/lists/label filters. Fallback if index upkeep is unwanted:
Pagefind (HTML-sourced, page-level).

## 9. Roadmap
1–6 **Done**: foundation (schema, build, scaffold, `fastapi` note); core rendering (block
renderer, collapsible TreeView + revision, router, Shiki, images); search & labels (MiniSearch
§8 + Cmd-K, faceted label pages); authoring (admin studio + import-from-txt + duplication §7a);
learning UX (Doc/Flashcard views, bookmarks, dark mode); catalog + topics + polish
(`domain→category→topic`, recursive `topic` role + `resolveTopic`, Shiki dual-theme, `highlight[]`,
`related[]` + `updated`, admin topic toggle + catalog CRUD).
7. **Migration** (remaining) — bulk-convert existing repo notes per `TOOLS.md`. One `category`
   per technology; multi-file techs → multiple notes or one merged note (`--append`). Fence code,
   convert, review in dev, enrich, seed role/category/domain, set `draft: false`.

## 10. Open items
- Repo name + hosting target (default: single repo on Cloudflare/GitHub Pages).
- Note granularity: per-concept grouped by category (recommended) vs per-technology.

## 11. Known issues / future work
- **No tests** — `search.ts` / `tree.ts` / `cards.ts` / `dupes.ts` are ideal unit targets.
- Enhancements: per-topic TOC + prev/next sibling nav; copy-deep-link per topic; SM-2 spaced
  repetition; Mermaid block; hover-prefetch; wiki cross-note links (needs spans/marks);
  print/export-to-Markdown.
- **Rich presentation components** (deferred, not now): Claude-style display blocks like `tabs`
  (`{ items:[{label, body[]}] }`), accordions, etc. Each ships as a **new typed block** (type +
  renderer + editor control) per the extensibility rule — *not* a generic raw-HTML escape hatch.
- **Rejected — generic `html` node / inline rich text (spans+marks):** an `html` block was
  considered and dropped (reintroduces presentation-in-content, defeats search indexing, XSS
  surface, breaks the typed-block discipline). Inline emphasis/links would instead come from the
  planned `text` spans+marks upgrade if/when needed; both are out of scope for now.
