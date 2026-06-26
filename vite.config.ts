import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { contentDevServer } from "./tools/dev/content-plugin.ts";

// Pure client-rendered SPA.
// - dev: notes are served live from content/ (contentDevServer) for an edit-and-refresh loop.
// - build: scripts/build-content.ts generates public/content (strict, drafts excluded).
export default defineConfig({
  plugins: [react(), contentDevServer()],
});
