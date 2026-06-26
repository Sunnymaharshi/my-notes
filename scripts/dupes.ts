/**
 * Duplication report (PLAN §7a).
 *
 * Reads every note in content/notes/ and reports groups of identical outline text or code
 * that appear more than once — within a note and across notes — so they can be merged or
 * removed during migration. Detection logic lives in src/lib/dupes.ts (shared with the admin).
 *
 *   npm run dupes            # human-readable report
 *   npm run dupes -- --json  # machine-readable groups
 *
 * Exits 0 always (this is advisory, not a gate). Drafts are included.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NoteSchema, type Note } from "../src/lib/schema.ts";
import { findDuplicates, type DupeGroup } from "../src/lib/dupes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const notesDir = path.join(root, "content", "notes");

const asJson = process.argv.includes("--json");

async function loadNotes(): Promise<Note[]> {
  const entries = await fs.readdir(notesDir, { withFileTypes: true });
  const notes: Note[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(notesDir, e.name, "index.json"), "utf8"));
      const parsed = NoteSchema.safeParse(raw);
      if (parsed.success) notes.push(parsed.data);
      else console.error(`  (skipped ${e.name}: schema invalid)`);
    } catch (err) {
      console.error(`  (skipped ${e.name}: ${(err as Error).message})`);
    }
  }
  return notes;
}

const truncate = (s: string, n = 80) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function report(groups: DupeGroup[]): void {
  if (groups.length === 0) {
    console.log("✔ No duplicate text or code found.");
    return;
  }
  const total = groups.reduce((n, g) => n + g.occurrences.length, 0);
  console.log(`⚠ ${groups.length} duplicate group(s), ${total} occurrence(s):\n`);
  for (const g of groups) {
    console.log(`  [${g.kind}] ×${g.occurrences.length}  ${truncate(g.normalized)}`);
    for (const occ of g.occurrences) {
      console.log(`      - ${occ.noteId}#n${occ.path}`);
    }
    console.log("");
  }
  console.log("Tip: merge or remove repeats so each concept lives in one place.");
}

async function main() {
  const notes = await loadNotes();
  const groups = findDuplicates(notes);
  if (asJson) {
    process.stdout.write(JSON.stringify(groups, null, 2) + "\n");
  } else {
    report(groups);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
