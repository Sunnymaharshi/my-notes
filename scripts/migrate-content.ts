/**
 * Content migration runner.
 *
 * Source of truth is content/notes/<id>/index.json. When the content model has a
 * BREAKING change, bump CURRENT_SCHEMA_VERSION (src/lib/schema.ts) and add a
 * migration here keyed by the version it upgrades FROM. This script walks every
 * note, applies migrations in order until it reaches the current version,
 * re-validates the result against the Zod schema, and rewrites the file in place.
 *
 * Notes written before versioning have no `schemaVersion`; they are treated as 1.
 *
 *   npm run migrate            # rewrite notes-on-disk to the current version
 *   npm run migrate -- --check # report what would change; write nothing
 *
 * Adding a node type is NOT a breaking change and needs no migration — only a
 * change to the shape/meaning of an existing type/field does.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NoteSchema, CURRENT_SCHEMA_VERSION } from "../src/lib/schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, "..", "content", "notes");

const checkOnly = process.argv.includes("--check");

/**
 * Migrations keyed by the version they upgrade FROM. Each takes a raw note at
 * version N and returns it at version N+1 (including the bumped `schemaVersion`).
 * Keep them pure and defensive — they run against on-disk JSON, not parsed data.
 *
 * Example (when v2 lands, e.g. outline/text `text: string` -> spans[]):
 *   1: (note) => ({
 *     ...note,
 *     schemaVersion: 2,
 *     body: note.body.map(textToSpans),
 *   }),
 */
const migrations: Record<number, (note: any) => any> = {};

function migrate(note: any): any {
  let current = { ...note };
  let version: number = current.schemaVersion ?? 1;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) {
      throw new Error(
        `no migration registered from schemaVersion ${version} (target ${CURRENT_SCHEMA_VERSION})`,
      );
    }
    current = step(current);
    if ((current.schemaVersion ?? 1) <= version) {
      throw new Error(`migration from ${version} did not advance schemaVersion`);
    }
    version = current.schemaVersion;
  }
  return current;
}

async function main() {
  const entries = await fs.readdir(notesDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  let migrated = 0;
  let upToDate = 0;
  const errors: string[] = [];

  for (const id of dirs) {
    const file = path.join(notesDir, id, "index.json");
    let raw: any;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      errors.push(`${id}: invalid JSON — ${(err as Error).message}`);
      continue;
    }

    const from = raw.schemaVersion ?? 1;
    if (from >= CURRENT_SCHEMA_VERSION) {
      upToDate++;
      continue;
    }

    let next: any;
    try {
      next = migrate(raw);
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
      continue;
    }

    const parsed = NoteSchema.safeParse(next);
    if (!parsed.success) {
      errors.push(
        `${id}: migrated note failed validation —\n` +
          parsed.error.issues
            .map((i) => `      ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n"),
      );
      continue;
    }

    migrated++;
    console.log(`  ${id}: ${from} → ${CURRENT_SCHEMA_VERSION}${checkOnly ? " (check)" : ""}`);
    if (!checkOnly) {
      // Preserve readable, indented JSON (notes are hand-edited source).
      await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n");
    }
  }

  if (errors.length > 0) {
    console.error(`\n✖ Migration failed (${errors.length}):\n`);
    for (const e of errors) console.error("  - " + e + "\n");
    process.exit(1);
  }

  console.log(
    `✔ ${migrated} note(s) ${checkOnly ? "would be migrated" : "migrated"}, ` +
      `${upToDate} already at version ${CURRENT_SCHEMA_VERSION}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
