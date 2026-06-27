/**
 * The "Generated" half of the studio — the live view of the note being edited, bound
 * directly to `note.body`. Three tabs, all reading/writing the same tree:
 *   - Preview: the real site renderer (TreeView) with live Shiki highlighting.
 *   - Edit:    the visual BlockEditor (add / insert-anywhere / reorder / delete via buttons).
 *   - JSON:    an editable, schema-validated JSON view of the body.
 * Editing in any tab flows out through `onBody`; the others stay in sync.
 */
import { Component, useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { z } from "zod";
import { BlockNodeSchema, type BlockNode, type Note } from "../../src/lib/schema.ts";
import type { DupeGroup } from "../../src/lib/dupes.ts";
import { Preview } from "./Preview.tsx";
import { BlockEditor } from "./BlockEditor.tsx";

const BodySchema = z.array(BlockNodeSchema);

/**
 * Isolates a render crash in one tab (typically Preview, which runs the real site
 * renderer) so it shows an in-pane message instead of unmounting the tab bar. `resetKey`
 * changes when you switch tabs or edit the body, which clears the error and retries.
 */
class TabErrorBoundary extends Component<
  { resetKey: unknown; children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error)
      return (
        <div className="paneError" style={{ borderTop: "none" }}>
          Preview error: {this.state.error}
        </div>
      );
    return this.props.children;
  }
}

type View = "preview" | "edit" | "json";

export function GeneratedPane({
  note,
  onBody,
  dupeFlags,
  scrollRef,
  onAssetChange,
}: {
  note: Note;
  onBody: (body: BlockNode[]) => void;
  dupeFlags: Map<string, DupeGroup>;
  /** Receives the active scroll container, for optional scroll-sync with Source. */
  scrollRef?: MutableRefObject<HTMLElement | null>;
  /** Called after an image upload, so the Assets panel can refresh. */
  onAssetChange?: () => void;
}) {
  // Callback ref: point the shared scroll ref at whichever scroller this tab renders.
  const setScroll = (el: HTMLElement | null) => {
    if (scrollRef) scrollRef.current = el;
  };
  const [view, setView] = useState<View>("edit");
  const [jsonText, setJsonText] = useState(() => JSON.stringify(note.body, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Keep the JSON text fresh from the body unless the user is actively editing it.
  useEffect(() => {
    if (view !== "json") {
      setJsonText(JSON.stringify(note.body, null, 2));
      setJsonError(null);
    }
  }, [note.body, view]);

  const onJsonChange = (v: string) => {
    setJsonText(v);
    let data: unknown;
    try {
      data = JSON.parse(v);
    } catch (e) {
      setJsonError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const parsed = BodySchema.safeParse(data);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      setJsonError(`Schema: ${i.path.join(".") || "(root)"} — ${i.message}`);
      return;
    }
    setJsonError(null);
    onBody(parsed.data);
  };

  return (
    <div className="importPane genPane">
      <div className="paneHead">
        Generated
        <span className="spacer" />
        {(["preview", "edit", "json"] as View[]).map((v) => (
          <button
            key={v}
            className={`tiny ${view === v ? "primary" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "preview" ? "Preview" : v === "edit" ? "Edit" : "JSON"}
          </button>
        ))}
      </div>

      <TabErrorBoundary resetKey={`${view}:${note.body.length}`}>
        {view === "json" ? (
          <textarea
            ref={setScroll}
            className="mono importArea"
            spellCheck={false}
            placeholder="Block JSON. Edits validate live against the schema."
            value={jsonText}
            onChange={(e) => onJsonChange(e.target.value)}
          />
        ) : view === "edit" ? (
          <div className="paneBody genEdit" ref={setScroll}>
            <BlockEditor body={note.body} onChange={onBody} dupeFlags={dupeFlags} noteId={note.id} onAssetChange={onAssetChange} />
          </div>
        ) : (
          <div className="paneBody" ref={setScroll}>
            {note.body.length ? (
              <Preview note={note} />
            ) : (
              <p className="hint">Nothing to preview yet — add blocks in Edit, or paste in Source.</p>
            )}
          </div>
        )}
      </TabErrorBoundary>

      {jsonError && <div className="paneError">{jsonError}</div>}
    </div>
  );
}
