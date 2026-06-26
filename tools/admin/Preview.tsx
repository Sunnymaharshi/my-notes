/**
 * Live preview — renders just the note body (TreeView) with no chrome: no breadcrumbs,
 * no header, no view switcher, no related section. Uses the real block renderers so
 * what you see matches production output.
 *
 * Code blocks carry no `codeHtml` in admin (that's injected build/dev-side), so we
 * debounce-call the admin /api/highlight route to decorate `code` nodes with Shiki HTML
 * — exact parity with the deployed site (same dual themes + highlight[] line tagging).
 */
import { useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import type { BlockNode, Note } from "../../src/lib/schema.ts";
import { NoteContext } from "../../src/components/blocks/context.ts";
import { TreeView } from "../../src/components/views/TreeView.tsx";
import { TooltipProvider } from "../../src/components/ui/Tooltip.tsx";
import { api } from "./api.ts";
import "../../src/index.css";

// True when any code node still lacks highlighted HTML.
const needsHighlight = (body: BlockNode[]): boolean =>
  body.some(
    (n) =>
      (n.type === "code" && !(n as { codeHtml?: string }).codeHtml) ||
      (n.type === "outline" && n.children ? needsHighlight(n.children) : false),
  );

export function Preview({ note }: { note: Note }) {
  // Locally-highlighted copy of the body; falls back to the raw body until decorated.
  const [body, setBody] = useState<BlockNode[]>(note.body);
  const reqId = useRef(0);

  useEffect(() => {
    if (!needsHighlight(note.body)) {
      setBody(note.body);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      api
        .highlight(note.body)
        .then((r) => id === reqId.current && setBody(r.body))
        .catch(() => id === reqId.current && setBody(note.body));
    }, 200);
    return () => clearTimeout(t);
  }, [note.body]);

  const shown: Note = { ...note, body };

  return (
    <MemoryRouter>
      <TooltipProvider delayDuration={350} skipDelayDuration={200}>
        <NoteContext.Provider value={{ noteId: note.id }}>
          <div className="previewSurface">
            <TreeView note={shown} showControls={false} />
          </div>
        </NoteContext.Provider>
      </TooltipProvider>
    </MemoryRouter>
  );
}
