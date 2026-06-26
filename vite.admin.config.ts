import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminApi } from "./tools/admin/server.ts";
import { contentDevServer } from "./tools/dev/content-plugin.ts";

// Local-only admin studio (PLAN §7). `npm run admin` runs this config.
// - root is tools/admin (its own index.html / entry), separate from the site app.
// - adminApi: tiny Node API reading/writing content/notes/.
// - contentDevServer: serves /content/* so the live preview can resolve note images.
// Never built or deployed — production uses vite.config.ts only.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repoRoot, "tools", "admin"),
  // imports reach into ../../src and ../../content, outside the Vite root.
  server: { port: 5174, open: true, fs: { allow: [repoRoot] } },
  plugins: [react(), adminApi(), contentDevServer()],
});
