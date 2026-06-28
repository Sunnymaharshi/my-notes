/**
 * Deterministic notes-file -> skeleton note JSON parser.
 *
 * Input: a notes file (.py / .js / .txt / ...) written as an indented outline, with code
 * wrapped in ``` fences (optionally ```lang). Fences may carry a leading line-comment marker
 * on either end (`# ```, `// ```, `-- ```, `* ```) so they read as natural comments in the host
 * language — the marker is stripped, including on the closing fence. The container's block-comment
 * delimiters (""" ... """, ''' ... ''', /* ... *\/) are stripped automatically too.
 *
 * Output: a schema-valid skeleton note. Structure is faithful and lossless — indentation
 * becomes the outline tree, fenced blocks become `code` nodes. The envelope is stubbed and
 * the note is marked `draft: true`; an enrichment pass (admin/AI, see README.md) then fills
 * summary/labels/category, promotes callouts/tables/flashcards, and splits per concept.
 *
 *   npm run convert -- <file> [--id <id>] [--title <t>] [--category <c>] [--write]
 *
 * Without --write it prints JSON to stdout. With --write it saves to
 * content/notes/<id>/index.json. Either way, run `npm run content` to validate.
 *
 * Merging multiple files into one note (e.g. a technology split across files):
 *   npm run convert -- <file> --append <existing-id> [--section "Title"]
 * appends the file's tree as a new top-level section of content/notes/<existing-id>.
 *
 * Splitting one file into many notes: put `~~~ Title` divider lines between sections (any
 * comment prefix works — `# ~~~ …`, `// ~~~ …`, `-- ~~~ …`). Each section becomes its own
 * draft note (id slugged from the title, or `~~~ my-id | Title` to set it). `--category`
 * applies to all; with `--write` each note is written to content/notes/<id>/index.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BlockNode, Note, OutlineNode } from "../../src/lib/schema.ts";
import { CURRENT_SCHEMA_VERSION } from "../../src/lib/schema.ts";

const TAB = "    ";
export const EXT_LANG: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".sql": "sql",
  ".sh": "bash",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/-?notes?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripCommentWrapper(lines: string[]): string[] {
  const isDelim = (l: string) => /^\s*("""|'''|\/\*|\*\/)\s*$/.test(l);
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  if (start < end && isDelim(lines[start])) start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  if (end > start && isDelim(lines[end - 1])) end--;
  return lines.slice(start, end);
}

const indentOf = (line: string) =>
  line.replace(/\t/g, TAB).match(/^ */)![0].length;

// A leading comment marker — a line comment (#, //, --) or a block-comment opener/closer
// (triple-quote, slash-star, star-slash) — at the start of a line, with the indentation before
// it preserved. A lone `*` is excluded so `*`-bullets aren't mistaken for a comment.
const LEADING_COMMENT_RE = /^(\s*)(?:#+|\/\/+|--+|"""|'''|\/\*|\*\/)[ \t]?/;

// Block-comment delimiters (triple-quote, slash-star, star-slash) anywhere on a line — removed
// wholesale so an inline `note` wrapper or a trailing closer leaves just the prose behind.
const BLOCK_DELIM_RE = /"""|'''|\/\*|\*\//g;

// A line-comment marker (#, //, --) appearing anywhere, but only when it stands alone — at the
// start of the line or preceded by whitespace. The marker token is dropped (the note text after
// it is kept). The whitespace boundary protects `https://…` and `a--b` from being mangled.
const LINE_COMMENT_RE = /(^|\s)(?:#+|\/\/+|--+)[ \t]?/g;

/** Strip all comment delimiters from one out-of-fence line, preserving the prose they wrap. */
function stripOutside(line: string): string {
  return line
    .replace(LEADING_COMMENT_RE, "$1") // leading marker → keep indentation
    .replace(BLOCK_DELIM_RE, "") // remaining inline/trailing block delimiters
    .replace(LINE_COMMENT_RE, "$1") // remaining inline line-comment markers
    .replace(/[ \t]+$/, "");
}

/** Box-drawing chars used in ASCII trees (`├── └── │`); such lines are kept verbatim. */
const isTreeLine = (line: string) => /[│├└┌┐┘┴┬┼╰╮╭╯─]/.test(line);

/** A Markdown table separator row, e.g. `|---|:--:|` (≥2 columns). */
const isSeparator = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

/** Split a `| a | b |` row into trimmed cells (outer pipes optional). */
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/**
 * Tidy raw notes before parsing (paste-cleanup). The text is tokenized on ``` so a fence can sit
 * anywhere — even right after a comment delimiter (`""" ```python`). Inside a fenced region the
 * content is kept byte-for-byte; outside it, every comment delimiter is removed (block delimiters
 * and line-comment markers, anywhere) so the prose they wrap survives, and runs of blank lines
 * collapse to one. Fences are re-emitted on their own lines (carrying the opening line's
 * indentation) so the downstream parser sees clean, well-nested code blocks.
 */
export function cleanRawLines(text: string): string[] {
  const out: string[] = [];
  let blankRun = 0;
  // Splitting on ``` yields alternating regions: even index = outside prose, odd = code body.
  const parts = text.split("```");
  // Indentation of the line carrying the upcoming opening fence (so the code nests correctly).
  let fenceIndent = "";

  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      const lines = part.split("\n");
      lines.forEach((raw, idx) => {
        // The final line of an outside region is the one that holds the next opening ```.
        if (idx === lines.length - 1) fenceIndent = raw.match(/^[ \t]*/)![0];
        const line = stripOutside(raw);
        if (line.trim() === "") {
          if (++blankRun <= 1) out.push("");
          return;
        }
        blankRun = 0;
        out.push(line);
      });
    } else {
      // Code region between two ``` markers: first line is the info string (lang[:filename]).
      blankRun = 0;
      const lines = part.split("\n");
      // The closing fence may carry a leading comment marker (`# ```, `// ```, `* ```), so the
      // text on the line before the closing ``` is a comment-only fragment, not code. Drop a
      // trailing comment-marker-only line so the marker doesn't leak into the code body.
      let endLine = lines.length;
      if (endLine > 1 && /^\s*(?:#+|\/\/+|--+|\*)\s*$/.test(lines[endLine - 1])) endLine--;
      out.push(`${fenceIndent}\`\`\`${lines[0].trim()}`);
      for (let k = 1; k < endLine; k++) out.push(lines[k]);
      out.push(`${fenceIndent}\`\`\``);
      fenceIndent = "";
    }
  });
  return out;
}

/**
 * A note divider: a line of `~~~ Title`, recognized with or without any leading line-comment
 * prefix (`#`, `//`, `--`, `*`) so it reads as a natural comment in any source file.
 * The captured remainder is the note's title; an optional `id | Title` form sets the id
 * explicitly (e.g. `~~~ redis-cache | Redis Caching`).
 */
const DIVIDER_RE = /^\s*(?:#+|\/\/+|--+|\*)?\s*~{3,}\s*(.*)$/;

export interface RawSegment {
  title?: string;
  id?: string;
  text: string;
}

/**
 * Split a raw notes file into per-note segments on `=== Title` divider lines. Dividers inside
 * ``` fences are ignored. A file with no dividers yields a single title-less segment — the
 * legacy one-note-per-file case. Pass text that already had its comment wrapper stripped so a
 * leading/trailing `"""` / `/*` doesn't leak into the first or last segment.
 */
export function splitSegments(text: string): RawSegment[] {
  const segs: { title?: string; id?: string; lines: string[] }[] = [{ lines: [] }];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      segs[segs.length - 1].lines.push(line);
      continue;
    }
    const m = inFence ? null : line.match(DIVIDER_RE);
    if (m) {
      const raw = m[1].trim();
      let id: string | undefined;
      let title: string | undefined = raw || undefined;
      if (raw.includes("|")) {
        const [a, b] = raw.split("|");
        id = a.trim() || undefined;
        title = b.trim() || undefined;
      }
      segs.push({ title, id, lines: [] });
    } else {
      segs[segs.length - 1].lines.push(line);
    }
  }
  // Drop a leading preamble segment that's effectively empty (file started with a divider).
  if (segs.length > 1 && segs[0].lines.join("").trim() === "") segs.shift();
  return segs.map((s) => ({ title: s.title, id: s.id, text: s.lines.join("\n") }));
}

interface Frame {
  indent: number;
  node: { children?: BlockNode[] };
}

/** Seed `role: "topic"` on the top-level outline branches only (depth-0 nodes that have
 *  children). A faithful first guess at the self-contained, search-deep-linkable units;
 *  promote deeper nodes to topics by hand in the admin (see tools/convert/README.md).
 *  Everything below the top level stays an unmarked detail line until opted in. */
function seedRoles(nodes: BlockNode[], depth = 0): void {
  if (depth > 0) return;
  for (const node of nodes) {
    if (node.type !== "outline" || !node.children?.length) continue;
    node.role = "topic";
  }
}

export function parse(text: string, defaultLang: string): BlockNode[] {
  const lines = cleanRawLines(text);
  const root: { children: BlockNode[] } = { children: [] };
  const stack: Frame[] = [{ indent: -1, node: root }];

  const parentFor = (indent: number) => {
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    return stack[stack.length - 1].node;
  };
  const addChild = (parent: { children?: BlockNode[] }, child: BlockNode) => {
    (parent.children ??= []).push(child);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // Fenced code block. The info string is `lang` or `lang:filename` (the filename is shown
    // immersed in the block, no header bar).
    if (trimmed.startsWith("```")) {
      const fenceIndent = indentOf(line);
      const info = trimmed.slice(3).trim();
      const [langPart, ...rest] = info.split(":");
      // Strip any `@N` depth hint from the lang token before using it.
      const lang = (langPart.trim().replace(/@\d+/, "").trim()) || defaultLang;
      const filename = rest.join(":").trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        const l = lines[i].replace(/\t/g, TAB);
        codeLines.push(l.slice(Math.min(fenceIndent, l.length - l.trimStart().length)));
        i++;
      }
      const code = codeLines.join("\n").replace(/\s+$/, "");
      const codeNode: BlockNode =
        lang === "pre"
          ? { type: "pre", text: code }
          : { type: "code", lang, code };
      if (lang !== "pre" && filename) (codeNode as { filename?: string }).filename = filename;
      // `@N` in the fence info string (e.g. ```python @2) is an explicit depth hint:
      // treat the block as if it were at indentation depth N (1-based outline levels).
      // Useful when the fence physically sits at col 0 (e.g. ruff-linted .py files) but
      // logically belongs under a nested outline node. Without the hint, physical indent wins.
      const depthMatch = info.match(/@(\d+)/);
      const effectiveIndent = depthMatch ? Number(depthMatch[1]) * 4 : fenceIndent;
      addChild(parentFor(effectiveIndent), codeNode);
      continue;
    }

    // Markdown pipe table: a `| … |` header row immediately followed by a `|---|` separator.
    if (trimmed.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const tableIndent = indentOf(line);
      const headers = splitCells(trimmed);
      const rows: string[][] = [];
      i += 2; // consume header + separator
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        const cells = splitCells(lines[i]);
        while (cells.length < headers.length) cells.push("");
        rows.push(cells.slice(0, headers.length));
        i++;
      }
      i--; // the for-loop will ++ past the last consumed line
      addChild(parentFor(tableIndent), { type: "table", headers, rows });
      continue;
    }

    // ASCII tree / box-drawing run → kept verbatim as a plain `code` block.
    if (isTreeLine(line)) {
      const run: string[] = [];
      while (i < lines.length && isTreeLine(lines[i])) {
        run.push(lines[i]);
        i++;
      }
      i--;
      const minIndent = Math.min(...run.map(indentOf));
      const code = run
        .map((l) => l.replace(/\t/g, TAB).slice(minIndent))
        .join("\n")
        .replace(/\s+$/, "");
      addChild(parentFor(minIndent), { type: "code", lang: "text", code });
      continue;
    }

    // Outline node.
    const indent = indentOf(line);
    const node: OutlineNode = { type: "outline", text: trimmed };
    addChild(parentFor(indent), node);
    stack.push({ indent, node });
  }

  seedRoles(root.children);
  return root.children;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error(
      "Usage: npm run convert -- <file> [--id <id>] [--title <t>] [--category <c>] [--write]\n" +
        "       (use `~~~ Title` divider lines in the file to emit multiple notes at once)",
    );
    process.exit(1);
  }

  const text = await fs.readFile(file, "utf8");
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const defaultLang = EXT_LANG[ext] ?? "text";

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "..", "..");
  const today = new Date().toISOString().slice(0, 10);

  // Multi-note file: `=== Title` divider lines split one prepared file into several notes.
  // Strip the file's comment wrapper first so a leading/trailing """ / /* doesn't leak into
  // the first or last segment.
  const segments = splitSegments(stripCommentWrapper(text.split("\n")).join("\n"));
  const multi = segments.length > 1 || segments.some((s) => s.title);
  if (multi) {
    if (arg("append")) {
      console.error("✖ --append can't be combined with ~~~ note dividers (the file is multiple notes).");
      process.exit(1);
    }
    const category = arg("category") ?? "uncategorized";
    const notes: Note[] = segments.map((seg) => {
      let segBody = parse(seg.text, defaultLang);
      let segTitle = seg.title;
      if (!segTitle) {
        // No title on the divider (or a leading preamble) — lift a lone root topic, else file name.
        if (segBody.length === 1 && segBody[0].type === "outline") {
          segTitle = segBody[0].text;
          segBody = segBody[0].children ?? [];
          seedRoles(segBody);
        } else {
          segTitle = base.replace(/[-_]/g, " ");
        }
      }
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: slugify(seg.id ?? segTitle),
        title: segTitle,
        category,
        labels: [],
        summary: "",
        updated: today,
        draft: true,
        body: segBody,
      };
    });

    const dupId = notes.map((n) => n.id).find((id, i, a) => a.indexOf(id) !== i);
    if (dupId) {
      console.error(`✖ two notes resolve to the same id "${dupId}" — give one an explicit id via \`~~~ my-id | Title\`.`);
      process.exit(1);
    }

    if (process.argv.includes("--write")) {
      for (const note of notes) {
        const dest = path.join(projectRoot, "content", "notes", note.id);
        await fs.mkdir(dest, { recursive: true });
        await fs.writeFile(path.join(dest, "index.json"), JSON.stringify(note, null, 2) + "\n");
      }
      console.error(
        `✔ wrote ${notes.length} draft note(s): ${notes.map((n) => n.id).join(", ")} — set category/labels, then \`npm run content\``,
      );
    } else {
      process.stdout.write(JSON.stringify(notes, null, 2) + "\n");
      console.error(`(${notes.length} notes parsed; re-run with --write to save each to content/notes/<id>/index.json)`);
    }

    return;
  }

  // Single-note file (no dividers) — faithful one-note-per-file conversion.
  let body = parse(text, defaultLang);

  // If the whole file sits under a single root topic, lift it to the title.
  let title = arg("title") ?? base.replace(/[-_]/g, " ");
  if (!arg("title") && body.length === 1 && body[0].type === "outline") {
    title = body[0].text;
    body = body[0].children ?? [];
    seedRoles(body); // depths shifted up by the lift — re-seed the new top branches
  }

  // --append: merge this file's tree into an existing note as a new top-level section.
  const appendId = arg("append");
  if (appendId) {
    const dest = path.join(projectRoot, "content", "notes", appendId, "index.json");
    const existing: Note = JSON.parse(await fs.readFile(dest, "utf8"));
    const section = arg("section") ?? title;
    existing.body.push({ type: "outline", text: section, children: body });
    await fs.writeFile(dest, JSON.stringify(existing, null, 2) + "\n");
    console.error(
      `✔ appended ${body.length} node(s) to content/notes/${appendId}/index.json under "${section}" — then \`npm run content\``,
    );
    return;
  }

  const id = arg("id") ?? slugify(base);
  const note: Note = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    title,
    category: arg("category") ?? "uncategorized",
    labels: [],
    summary: "",
    updated: today,
    draft: true,
    body,
  };

  const json = JSON.stringify(note, null, 2);
  if (process.argv.includes("--write")) {
    const dest = path.join(projectRoot, "content", "notes", id);
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, "index.json"), json + "\n");
    console.error(`✔ wrote content/notes/${id}/index.json (draft) — set category/labels, then \`npm run content\``);
  } else {
    process.stdout.write(json + "\n");
  }
}

// Only run the CLI when executed directly (`npm run convert`), not when imported
// (e.g. the admin API reuses `parse`/`EXT_LANG`/`slugify`).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
