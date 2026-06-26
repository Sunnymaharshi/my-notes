/**
 * Deterministic notes-file -> skeleton note JSON parser.
 *
 * Input: a notes file (.py / .js / .txt / ...) written as an indented outline, with code
 * wrapped in ``` fences (optionally ```lang). The container's comment delimiters
 * (""" ... """, ''' ... ''', /* ... *\/) are stripped automatically.
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

function stripCommentWrapper(lines: string[]): string[] {
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

interface Frame {
  indent: number;
  node: { children?: BlockNode[] };
}

/** Seed `role: "topic"` on the top outline branches (depth 0–1 nodes that have children).
 *  A faithful first guess at the self-contained, search-deep-linkable units; refine by hand
 *  after converting (see tools/convert/README.md). Leaf lines stay unmarked details. */
function seedRoles(nodes: BlockNode[], depth = 0): void {
  if (depth > 1) return;
  for (const node of nodes) {
    if (node.type !== "outline" || !node.children?.length) continue;
    node.role = "topic";
    seedRoles(node.children, depth + 1);
  }
}

export function parse(text: string, defaultLang: string): BlockNode[] {
  const lines = stripCommentWrapper(text.split("\n"));
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

    // Fenced code block.
    if (trimmed.startsWith("```")) {
      const fenceIndent = indentOf(line);
      const lang = trimmed.slice(3).trim() || defaultLang;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "```") {
        codeLines.push(lines[i].replace(/\t/g, TAB).slice(fenceIndent));
        i++;
      }
      const code = codeLines.join("\n").replace(/\s+$/, "");
      addChild(parentFor(fenceIndent), { type: "code", lang, code });
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
    console.error("Usage: npm run convert -- <file> [--id <id>] [--title <t>] [--category <c>] [--write]");
    process.exit(1);
  }

  const text = await fs.readFile(file, "utf8");
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const defaultLang = EXT_LANG[ext] ?? "text";

  let body = parse(text, defaultLang);

  // If the whole file sits under a single root topic, lift it to the title.
  let title = arg("title") ?? base.replace(/[-_]/g, " ");
  if (!arg("title") && body.length === 1 && body[0].type === "outline") {
    title = body[0].text;
    body = body[0].children ?? [];
    seedRoles(body); // depths shifted up by the lift — re-seed the new top branches
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "..", "..");

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
    updated: new Date().toISOString().slice(0, 10),
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
