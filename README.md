# my-notes

A personal, searchable **developer-notes website** — a label-able knowledge base built for
quick reference and pre-interview revision. Notes are authored once as a structured JSON
block-tree and rendered as collapsible outlines, a flowing document, or a flashcard study
deck.

> Pure client-rendered React SPA. Production is **static and database-free**; the only
> stateful piece is a local-only authoring studio that never gets deployed. Nothing in the
> repo or the deployed site ever calls an AI model — any AI help is external and by hand.

---

## Features

### Reading & learning
- **Three views of every note**, switchable in the header:
  - **Outline** — animated collapsible tree (default), with **Expand all / Collapse all /
    Revision mode** (revision keeps only top-level sections open).
  - **Document** — the same tree as a flowing doc: depth-based headings, bulleted lists, and
    inline code/callouts/tables.
  - **Flashcards** — a keyboard-driven "test me" study deck. Sources explicit `flashcard`
    blocks; if a note has none, it falls back to outline `note` pairs so the deck is still
    useful. **Keys:** `←/→` prev/next, `Space`/`Enter` flip, `s` shuffle; progress bar.
- **Search** — custom MiniSearch index built from the note JSON at build time. Fuzzy +
  prefix type-ahead, weighted fields, label/category facets, and **node-level deep links**
  (a hit jumps to the exact subtopic, auto-expands its ancestors, and flashes it).
- **Command palette** — `⌘K` / `Ctrl-K` toggles, `/` opens. Jump to any note or search hit.
- **Labels** — clickable label chips, a home-page label cloud, and faceted label pages
  (combine co-occurring labels + in-facet text search).
- **Bookmarks** — star any note; bookmarks persist to `localStorage`, show in the sidebar,
  and sync across browser tabs.
- **Dark / light theme** — toggle in the sidebar, persisted, defaults to your system
  preference, applied before first paint (no flash).
- **Code** — pre-highlighted at build time with Shiki (no highlighter shipped to the
  browser), with copy-to-clipboard. Images are colocated per note and lazy-loaded.

### Content model
- One note per file: `content/notes/<id>/index.json`, validated by a single **Zod schema**
  (`src/lib/schema.ts`) at build, on admin save, and on import.
- A note is an envelope + a `body` array of typed block nodes:

  | type | shape |
  |---|---|
  | `outline` | `{ text, children?[], note? }` — the nested tree |
  | `code` | `{ lang, code, filename?, highlight?[] }` |
  | `image` | `{ src, alt, caption? }` |
  | `callout` | `{ variant, text }` (`tip\|warning\|info\|note\|gotcha`) |
  | `table` | `{ headers[], rows[][] }` |
  | `flashcard` | `{ q, a }` |

  **Extensibility rule:** a new capability is a new `type` + renderer + editor control — it
  never breaks existing notes.

### Authoring (both paths emit schema-valid JSON)
- **Local admin studio** (`npm run admin`, port 5174, never deployed) — three panes: note
  list · envelope form + recursive block editor · **live preview using the real site
  renderer**. Labels autocomplete, image upload (copied into the note folder), schema
  validation on save, and a per-node ⚠ when text/code is duplicated elsewhere. **Import**:
  paste raw notes → the deterministic parser builds blocks → review **side-by-side** (source
  vs generated, both editable, with linked/free scroll) → append or replace.
- **Conversion** (`npm run convert`) — a deterministic, lossless parser turns an indented
  notes file (with ``` fenced code) into a skeleton note; you then enrich the JSON.
- **Duplication detection** — `npm run dupes` reports repeated outline lines / code blocks
  within and across notes (the same ⚠ the admin shows). Useful during migration.

---

## Tech stack

Vite · React 18 + TypeScript · React Router · CSS Modules (no Tailwind) · Framer Motion ·
Shiki (build-time highlighting) · MiniSearch · cmdk · Zod. No backend, no SSR/SSG (no SEO
need) — content is static JSON fetched on demand.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — serves notes live from content/ (drafts shown)
```

Author content:

```bash
npm run admin      # http://localhost:5174 — local visual studio (never deployed)
```

Build for production:

```bash
npm run build      # validates content (strict, drafts excluded), type-checks, bundles to dist/
npm run preview    # preview the production build
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server; serves notes **live from `content/`** (edit-refresh, drafts shown). |
| `npm run admin` | Local-only authoring studio (port 5174): block editor + import + live preview. |
| `npm run convert -- <file> [flags]` | Parse a notes file → skeleton note JSON. |
| `npm run dupes [-- --json]` | Report duplicate outline text / code within and across notes. |
| `npm run content` | Validate all notes, emit `public/content/` (drafts excluded). |
| `npm run validate` | Validate only (no output written). |
| `npm run build` | Strict content build + type-check + production bundle (`dist/`). |
| `npm run preview` | Serve the production build locally. |

---

## Project structure

```
content/notes/<id>/index.json   # note source of truth (+ colocated images)
content/categories.json         # category enum
public/content/                 # GENERATED by `npm run content` — do not edit

src/
  lib/
    schema.ts                   # Zod schema — single source of truth for the content model
    content.ts                  # runtime fetch helpers (memoized) + asset resolution
    search.ts                   # MiniSearch config + per-note doc walker + node anchors
    tree.ts                     # branch-path collection for expand/collapse
    cards.ts                    # flashcard collector (explicit cards, else outline notes)
    bookmarks.ts                # localStorage bookmark store
    useTheme.ts                 # dark/light theme toggle
    useContent.ts               # shared metadata index + categories hook
  components/
    Layout.tsx                  # sidebar (search, theme, bookmarks) + <Outlet>
    NoteView.tsx                # header + bookmark star + Outline/Document/Flashcards switcher
    CommandPalette.tsx          # ⌘K / "/" palette
    views/                      # TreeView · DocView · FlashcardView
    blocks/                     # one renderer per node type + Tree/Note context
  pages/                        # Home · Category · Note · Label
  main.tsx                      # React Router setup

scripts/
  build-content.ts              # validate notes + emit metadata/search index (prod build)
  dupes.ts                      # duplicate-report CLI

tools/
  convert/parse.ts              # notes file -> skeleton JSON (deterministic; exports parse())
  dev/content-plugin.ts         # dev: serve notes live from content/
  lib/highlight.ts              # Shiki: inject highlighted HTML into code nodes
  admin/                        # local-only studio (npm run admin)

vite.admin.config.ts            # admin Vite config (port 5174; never built/deployed)
```

---

## Deployment

Any static host with an SPA fallback (all routes → `index.html`): e.g. Cloudflare Pages or
GitHub Pages. Build command `npm run build`, output directory `dist/`. The admin studio and
`content/` source are **not** part of the deployed bundle.

---

## Documentation

- **[PLAN.md](PLAN.md)** — full architecture, locked decisions, and roadmap.
- **[TOOLS.md](TOOLS.md)** — tooling and build commands.
- **[MIGRATION.md](MIGRATION.md)** — step-by-step guide to bringing existing notes into the site.
- **[tools/convert/README.md](tools/convert/README.md)** — the convert → enrich procedure + node cheat sheet.
- **[CLAUDE.md](CLAUDE.md)** — condensed instructions and project status.
