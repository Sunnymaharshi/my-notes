/**
 * Live preview — renders just the note body (TreeView) with no chrome: no breadcrumbs,
 * no header, no view switcher, no related section. Uses the real block renderers so
 * what you see matches production output.
 */
import { MemoryRouter } from "react-router-dom";
import type { Note } from "../../src/lib/schema.ts";
import { NoteContext } from "../../src/components/blocks/context.ts";
import { TreeView } from "../../src/components/views/TreeView.tsx";
import { TooltipProvider } from "../../src/components/ui/Tooltip.tsx";
import "../../src/index.css";

export function Preview({ note }: { note: Note }) {
  return (
    <MemoryRouter>
      <TooltipProvider delayDuration={350} skipDelayDuration={200}>
        <NoteContext.Provider value={{ noteId: note.id }}>
          <div className="previewSurface">
            <TreeView note={note} showControls={false} />
          </div>
        </NoteContext.Provider>
      </TooltipProvider>
    </MemoryRouter>
  );
}
