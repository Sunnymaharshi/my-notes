/**
 * Dev-only Vite plugin: serve notes live from the `content/` source.
 *
 * In dev, /content/* is served straight from content/ (not the generated public/content),
 * so editing a note's JSON and refreshing shows the change immediately — the judge-and-edit
 * loop. Drafts are included and schema errors are logged (not fatal) so you can still see a
 * work-in-progress note rendered while you fix it. Production (`npm run build`) still uses
 * the strict scripts/build-content.ts output, which excludes drafts.
 */
import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NoteSchema, type Note, type NoteMeta } from "../../src/lib/schema.ts";
import { highlightNote } from "../lib/highlight.ts";
import { buildSearchIndex } from "../../src/lib/search.ts";
import type { ZodError } from "zod";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const fmt = (e: ZodError) =>
  e.issues.map((i) => `    ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");

export function contentDevServer(): Plugin {
  const root = process.cwd();
  const contentDir = path.join(root, "content");
  const notesDir = path.join(contentDir, "notes");

  return {
    name: "notes-content-dev",
    apply: "serve",
    configureServer(server) {
      const sendJson = (res: import("node:http").ServerResponse, data: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      };

      const buildIndex = async (): Promise<NoteMeta[]> => {
        const dirs = await fs.readdir(notesDir, { withFileTypes: true });
        const meta: NoteMeta[] = [];
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          try {
            const raw = JSON.parse(
              await fs.readFile(path.join(notesDir, d.name, "index.json"), "utf8"),
            );
            const parsed = NoteSchema.safeParse(raw);
            if (parsed.success) {
              const n = parsed.data;
              meta.push({
                id: n.id,
                title: n.title,
                category: n.category,
                labels: n.labels,
                summary: n.summary,
                difficulty: n.difficulty,
                updated: n.updated,
                draft: n.draft,
              });
            } else {
              // Tolerant: still list it so it shows in the sidebar to be fixed.
              server.config.logger.warn(`[content] ${d.name} invalid:\n${fmt(parsed.error)}`);
              meta.push({
                id: raw.id ?? d.name,
                title: raw.title ?? d.name,
                category: raw.category ?? "uncategorized",
                labels: raw.labels ?? [],
                summary: raw.summary ?? "",
                updated: raw.updated ?? "",
                draft: true,
              });
            }
          } catch (err) {
            server.config.logger.error(`[content] ${d.name}: ${(err as Error).message}`);
          }
        }
        return meta.sort((a, b) => a.title.localeCompare(b.title));
      };

      // Collect every valid note (drafts included, like the dev index) for the search index.
      const buildSearch = async (): Promise<string> => {
        const dirs = await fs.readdir(notesDir, { withFileTypes: true });
        const notes: Note[] = [];
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          try {
            const raw = JSON.parse(
              await fs.readFile(path.join(notesDir, d.name, "index.json"), "utf8"),
            );
            const parsed = NoteSchema.safeParse(raw);
            if (parsed.success) notes.push(parsed.data);
          } catch {
            // skip unparseable notes; buildIndex already logs them
          }
        }
        return buildSearchIndex(notes);
      };

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url || !url.startsWith("/content/")) return next();
        try {
          if (url === "/content/index.json") return sendJson(res, await buildIndex());
          if (url === "/content/search-index.json") {
            res.setHeader("Content-Type", "application/json");
            return res.end(await buildSearch());
          }
          if (url === "/content/categories.json") {
            return sendJson(
              res,
              JSON.parse(await fs.readFile(path.join(contentDir, "categories.json"), "utf8")),
            );
          }
          if (url === "/content/domains.json") {
            return sendJson(
              res,
              JSON.parse(await fs.readFile(path.join(contentDir, "domains.json"), "utf8")),
            );
          }
          const m = url.match(/^\/content\/notes\/([^/]+)\/(.+)$/);
          if (m) {
            const file = path.join(notesDir, m[1], m[2]);
            if (m[2] === "index.json") {
              const raw = JSON.parse(await fs.readFile(file, "utf8"));
              const parsed = NoteSchema.safeParse(raw);
              if (!parsed.success) {
                server.config.logger.warn(`[content] ${m[1]} invalid:\n${fmt(parsed.error)}`);
                return sendJson(res, raw); // serve as-is so it still renders while being fixed
              }
              return sendJson(res, await highlightNote(parsed.data));
            }
            res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
            return res.end(await fs.readFile(file));
          }
          return next();
        } catch (err) {
          res.statusCode = 404;
          return sendJson(res, { error: (err as Error).message });
        }
      });

      // Reload the browser when any content file changes.
      const reload = (file: string) => {
        if (file.startsWith(contentDir)) server.ws.send({ type: "full-reload" });
      };
      server.watcher.add(path.join(contentDir, "**"));
      server.watcher.on("add", reload);
      server.watcher.on("change", reload);
      server.watcher.on("unlink", reload);
    },
  };
}
