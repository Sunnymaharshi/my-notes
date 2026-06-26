/**
 * Admin API (PLAN §7) — a Vite plugin exposing a tiny Node API over `content/notes/`.
 *
 * Local-only by design: this plugin is mounted solely by vite.admin.config.ts (`npm run
 * admin`), which the production build never uses. No DB, no auth — it just reads and writes
 * the JSON source of truth, validating with the same Zod schema as the build.
 *
 * Routes (all under /api):
 *   GET    /api/categories            -> categories.json
 *   GET    /api/notes                 -> [{id,title,category,labels,summary,draft,updated}]
 *   GET    /api/notes/:id             -> raw note JSON (un-highlighted, for editing)
 *   POST   /api/notes                 -> create skeleton {id,title,category} (draft)
 *   PUT    /api/notes/:id             -> validate + write (supports id rename)
 *   DELETE /api/notes/:id             -> remove the note folder
 *   POST   /api/notes/:id/assets      -> {filename, dataBase64} -> save image into the folder
 *   POST   /api/import                -> {text, ext?} -> deterministic parser -> skeleton body
 *   GET    /api/dupes                 -> duplicate groups across all notes (§7a)
 */
import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { NoteSchema, type Note, type NoteMeta } from "../../src/lib/schema.ts";
import { findDuplicates } from "../../src/lib/dupes.ts";
import { parse, EXT_LANG, slugify } from "../convert/parse.ts";

const root = process.cwd();
const contentDir = path.join(root, "content");
const notesDir = path.join(contentDir, "notes");

const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
};

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readNote(id: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(notesDir, id, "index.json"), "utf8"));
}

async function writeNote(note: Note): Promise<void> {
  const dir = path.join(notesDir, note.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(note, null, 2) + "\n");
}

async function listMeta(): Promise<NoteMeta[]> {
  const dirs = await fs.readdir(notesDir, { withFileTypes: true });
  const meta: NoteMeta[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const raw: any = await readNote(d.name);
      meta.push({
        id: raw.id ?? d.name,
        title: raw.title ?? d.name,
        category: raw.category ?? "uncategorized",
        labels: raw.labels ?? [],
        summary: raw.summary ?? "",
        difficulty: raw.difficulty,
        updated: raw.updated ?? "",
        draft: raw.draft ?? false,
      });
    } catch {
      // skip unreadable folders
    }
  }
  return meta.sort((a, b) => a.title.localeCompare(b.title));
}

async function allValidNotes(): Promise<Note[]> {
  const dirs = await fs.readdir(notesDir, { withFileTypes: true });
  const notes: Note[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const parsed = NoteSchema.safeParse(await readNote(d.name));
      if (parsed.success) notes.push(parsed.data);
    } catch {
      // skip
    }
  }
  return notes;
}

const today = () => new Date().toISOString().slice(0, 10);

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "", "http://localhost");
  const p = url.pathname;
  if (!p.startsWith("/api/")) return false;
  const method = req.method ?? "GET";

  // /api/categories
  if (p === "/api/categories" && method === "GET") {
    json(res, JSON.parse(await fs.readFile(path.join(contentDir, "categories.json"), "utf8")));
    return true;
  }

  // /api/dupes
  if (p === "/api/dupes" && method === "GET") {
    json(res, findDuplicates(await allValidNotes()));
    return true;
  }

  // /api/import
  if (p === "/api/import" && method === "POST") {
    const { text = "", ext = ".txt" } = await readBody(req);
    const lang = EXT_LANG[ext] ?? "text";
    json(res, { body: parse(String(text), lang) });
    return true;
  }

  // /api/notes  (list + create)
  if (p === "/api/notes" && method === "GET") {
    json(res, await listMeta());
    return true;
  }
  if (p === "/api/notes" && method === "POST") {
    const { id: rawId, title = "Untitled", category = "uncategorized" } = await readBody(req);
    const id = slugify(rawId || title);
    if (!id) return json(res, { error: "Could not derive an id" }, 400), true;
    try {
      await fs.access(path.join(notesDir, id));
      return json(res, { error: `Note "${id}" already exists` }, 409), true;
    } catch {
      // ok, doesn't exist
    }
    const note: Note = {
      id,
      title,
      category,
      labels: [],
      summary: "",
      updated: today(),
      draft: true,
      body: [],
    };
    await writeNote(note);
    json(res, note, 201);
    return true;
  }

  // /api/notes/:id  (+ /assets)
  const m = p.match(/^\/api\/notes\/([a-z0-9-]+)(\/assets)?$/);
  if (m) {
    const id = m[1];
    const isAssets = Boolean(m[2]);

    if (isAssets && method === "POST") {
      const { filename, dataBase64 } = await readBody(req);
      if (!filename || !dataBase64) return json(res, { error: "filename + dataBase64 required" }, 400), true;
      const safe = path.basename(String(filename));
      await fs.mkdir(path.join(notesDir, id), { recursive: true });
      await fs.writeFile(path.join(notesDir, id, safe), Buffer.from(dataBase64, "base64"));
      json(res, { src: safe });
      return true;
    }

    if (method === "GET") {
      try {
        json(res, await readNote(id));
      } catch {
        json(res, { error: `Note "${id}" not found` }, 404);
      }
      return true;
    }

    if (method === "PUT") {
      const incoming = await readBody(req);
      const parsed = NoteSchema.safeParse(incoming);
      if (!parsed.success) {
        json(res, { error: "validation", issues: parsed.error.issues }, 422);
        return true;
      }
      const note = parsed.data;
      note.updated = today();
      // Support id rename: write under note.id, remove the old folder if it changed.
      await writeNote(note);
      if (note.id !== id) {
        // carry over any colocated assets, then drop the old folder
        try {
          const entries = await fs.readdir(path.join(notesDir, id), { withFileTypes: true });
          for (const e of entries) {
            if (e.isFile() && e.name !== "index.json") {
              await fs.copyFile(
                path.join(notesDir, id, e.name),
                path.join(notesDir, note.id, e.name),
              );
            }
          }
        } catch {
          // no old folder / assets
        }
        await fs.rm(path.join(notesDir, id), { recursive: true, force: true });
      }
      json(res, note);
      return true;
    }

    if (method === "DELETE") {
      await fs.rm(path.join(notesDir, id), { recursive: true, force: true });
      json(res, { ok: true });
      return true;
    }
  }

  json(res, { error: `No route for ${method} ${p}` }, 404);
  return true;
}

export function adminApi(): Plugin {
  return {
    name: "notes-admin-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          if (!(await handle(req, res))) next();
        } catch (err) {
          json(res, { error: (err as Error).message }, 500);
        }
      });
    },
  };
}
