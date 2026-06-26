/**
 * Live preview — the real site renderer (PLAN §7: one source of truth). Renders the draft
 * note exactly as the site would via NoteView, inside a MemoryRouter so its internal <Link>s
 * and useLocation work without touching the admin's own routing. Code shows un-highlighted
 * (Shiki runs at build only); everything else matches production.
 */
import { MemoryRouter } from "react-router-dom";
import type { Note } from "../../src/lib/schema.ts";
import { NoteView } from "../../src/components/NoteView.tsx";
import "../../src/index.css";

export function Preview({ note }: { note: Note }) {
  return (
    <MemoryRouter>
      <div className="previewSurface">
        <NoteView note={note} />
      </div>
    </MemoryRouter>
  );
}
