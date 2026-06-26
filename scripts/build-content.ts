/**
 * Content build step.
 *
 * Source of truth: content/notes/<id>/index.json (+ colocated images).
 * This script:
 *   1. validates every note against the Zod schema (src/lib/schema.ts)
 *   2. emits a slim metadata index -> public/content/index.json
 *   3. copies categories + note files (and assets) -> public/content/**
 *
 * Run via `npm run content` (also runs automatically before dev/build).
 * Pass `--check` to validate only, without writing output.
 *
 * Later phases extend this with: MiniSearch index + pre-highlighted code.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NoteSchema,
  CategorySchema,
  DomainSchema,
  CURRENT_SCHEMA_VERSION,
  type Note,
  type NoteMeta,
} from "../src/lib/schema.ts";
import { highlightNote } from "../tools/lib/highlight.ts";
import { buildSearchIndex } from "../src/lib/search.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const contentDir = path.join(root, "content");
const notesDir = path.join(contentDir, "notes");
const outDir = path.join(root, "public", "content");

const checkOnly = process.argv.includes("--check");

async function listNoteDirs(): Promise<string[]> {
  const entries = await fs.readdir(notesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function copyAssets(srcDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "index.json") continue;
    if (entry.isFile()) {
      await fs.copyFile(path.join(srcDir, entry.name), path.join(destDir, entry.name));
    }
  }
}

async function main() {
  const dirs = await listNoteDirs();
  const meta: NoteMeta[] = [];
  const published: Note[] = [];
  const errors: string[] = [];
  let drafts = 0;

  if (!checkOnly) {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(path.join(outDir, "notes"), { recursive: true });
  }

  for (const id of dirs) {
    const noteDir = path.join(notesDir, id);
    const file = path.join(noteDir, "index.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      errors.push(`${id}: invalid JSON — ${(err as Error).message}`);
      continue;
    }

    const parsed = NoteSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`${id}: schema validation failed —\n${formatZodError(parsed.error)}`);
      continue;
    }
    const note = parsed.data;

    // Schema-version gate: a note older than the current model must be migrated
    // before it can build; a note newer than this build means stale output.
    if (note.schemaVersion < CURRENT_SCHEMA_VERSION) {
      errors.push(
        `${id}: schemaVersion ${note.schemaVersion} is behind current ${CURRENT_SCHEMA_VERSION} — run \`npm run migrate\``,
      );
      continue;
    }
    if (note.schemaVersion > CURRENT_SCHEMA_VERSION) {
      errors.push(
        `${id}: schemaVersion ${note.schemaVersion} is ahead of current ${CURRENT_SCHEMA_VERSION} — this build is stale; pull/rebuild`,
      );
      continue;
    }

    if (note.id !== id) {
      errors.push(`${id}: note id "${note.id}" does not match folder name "${id}"`);
      continue;
    }

    // Drafts are validated but not published.
    if (note.draft) {
      drafts++;
      continue;
    }

    meta.push({
      id: note.id,
      title: note.title,
      category: note.category,
      labels: note.labels,
      summary: note.summary,
      difficulty: note.difficulty,
      updated: note.updated,
    });
    published.push(note);

    if (!checkOnly) {
      const destDir = path.join(outDir, "notes", id);
      await fs.mkdir(destDir, { recursive: true });
      await fs.writeFile(
        path.join(destDir, "index.json"),
        JSON.stringify(await highlightNote(note), null, 0),
      );
      await copyAssets(noteDir, destDir);
    }
  }

  // Validate domains + categories, and that every category references a real domain.
  const domainsRaw = JSON.parse(
    await fs.readFile(path.join(contentDir, "domains.json"), "utf8"),
  );
  const domains = DomainSchema.array().safeParse(domainsRaw);
  if (!domains.success) {
    errors.push(`domains.json: ${formatZodError(domains.error)}`);
  }

  const categoriesRaw = JSON.parse(
    await fs.readFile(path.join(contentDir, "categories.json"), "utf8"),
  );
  const categories = CategorySchema.array().safeParse(categoriesRaw);
  if (!categories.success) {
    errors.push(`categories.json: ${formatZodError(categories.error)}`);
  } else if (domains.success) {
    const domainIds = new Set(domains.data.map((d) => d.id));
    for (const c of categories.data) {
      if (!domainIds.has(c.domain)) {
        errors.push(`categories.json: category "${c.id}" references unknown domain "${c.domain}"`);
      }
    }
  }

  // Every published note must reference a real category.
  if (categories.success) {
    const categoryIds = new Set(categories.data.map((c) => c.id));
    for (const n of published) {
      if (!categoryIds.has(n.category)) {
        errors.push(`note "${n.id}" references unknown category "${n.category}"`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n✖ Content validation failed (${errors.length}):\n`);
    for (const e of errors) console.error("  - " + e + "\n");
    process.exit(1);
  }

  meta.sort((a, b) => a.title.localeCompare(b.title));

  if (!checkOnly) {
    await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify(meta, null, 0));
    await fs.writeFile(path.join(outDir, "search-index.json"), buildSearchIndex(published));
    await fs.copyFile(
      path.join(contentDir, "categories.json"),
      path.join(outDir, "categories.json"),
    );
    await fs.copyFile(path.join(contentDir, "domains.json"), path.join(outDir, "domains.json"));
  }

  console.log(
    `✔ ${meta.length} note(s) validated${checkOnly ? " (check only)" : " and written to public/content"}` +
      `${drafts ? ` (${drafts} draft(s) skipped)` : ""}.`,
  );
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues
    .map((i) => `      ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
