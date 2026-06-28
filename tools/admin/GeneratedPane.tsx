/**
 * The "Generated" half of the studio — the live view of the note being edited, bound
 * directly to `note.body`. Three tabs, all reading/writing the same tree:
 *   - Preview: the real site renderer (TreeView) with live Shiki highlighting.
 *   - Edit:    the visual BlockEditor (add / insert-anywhere / reorder / delete via buttons).
 *   - JSON:    an editable, schema-validated JSON view of the body.
 * Editing in any tab flows out through `onBody`; the others stay in sync.
 */
import { Component, useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { z } from "zod";
import { BlockNodeSchema, type BlockNode, type Note } from "../../src/lib/schema.ts";
import type { DupeGroup } from "../../src/lib/dupes.ts";
import { clearGenHighlights, type FindMatch } from "./find-utils.ts";
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

/** Walk up from `el` to the nearest block-level ancestor inside `container`.
 *  Prevents scrolling to a tiny inline span — keeps heading context visible. */
function nearestBlock(el: HTMLElement | null, container: HTMLElement): HTMLElement | null {
  let curr = el;
  while (curr && curr !== container) {
    const display = getComputedStyle(curr).display;
    if (!display.startsWith("inline")) return curr;
    curr = curr.parentElement;
  }
  return el;
}

export function GeneratedPane({
  note,
  onBody,
  dupeFlags,
  scrollRef,
  onAssetChange,
  findMatch,
}: {
  note: Note;
  onBody: (body: BlockNode[]) => void;
  dupeFlags: Map<string, DupeGroup>;
  /** Receives the active scroll container, for optional scroll-sync with Source. */
  scrollRef?: MutableRefObject<HTMLElement | null>;
  /** Called after an image upload, so the Assets panel can refresh. */
  onAssetChange?: () => void;
  /** When set, scrolls the active pane to the Nth element whose text contains the term. */
  findMatch?: FindMatch | null;
}) {
  const paneBodyEl = useRef<HTMLElement | null>(null);

  // Stable callback ref — memoized so React doesn't call it null→element on every render,
  // which would briefly set paneBodyEl.current = null right before the find effect runs.
  const setScroll = useCallback((el: HTMLElement | null) => {
    if (scrollRef) scrollRef.current = el;
    paneBodyEl.current = el;
  }, [scrollRef]);

  // Highlight all matches in the right pane and scroll the active one to the top.
  // Re-fires on both term and idx changes so ↑/↓ navigation always triggers a scroll.
  // Cleanup clears highlights before each re-run and on unmount — more reliable than
  // calling clearGenHighlights() at the top, which can be skipped in batching scenarios.
  useEffect(() => {
    // Clear immediately on every run — handles the close case (findMatch → null)
    // and the navigate case (stale highlights before new ones are painted).
    clearGenHighlights();

    if (!findMatch?.term.trim() || !paneBodyEl.current) return clearGenHighlights;

    const container = paneBodyEl.current;
    const termLower = findMatch.term.toLowerCase();
    const termLen = findMatch.term.length;

    // Walk every text node, recording all per-character match positions.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    type Hit = { node: Text; start: number };
    const hits: Hit[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent ?? "";
      const lower = text.toLowerCase();
      let i = lower.indexOf(termLower);
      while (i !== -1) { hits.push({ node, start: i }); i = lower.indexOf(termLower, i + 1); }
    }
    if (!hits.length) return clearGenHighlights;

    const activeHit = hits[findMatch.idx % hits.length];

    // CSS Custom Highlight API — highlight all matches (dim) and active (bright).
    // Use window.CSS explicitly — same object used by clearGenHighlights().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const HL = (window.CSS as any).highlights;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const HLClass = (window as any).Highlight;
    if (HL && typeof HLClass !== "undefined") {
      try {
        const allRanges = hits.map(({ node, start }) => {
          const r = document.createRange();
          r.setStart(node, start);
          r.setEnd(node, start + termLen);
          return r;
        });
        const activeRange = document.createRange();
        activeRange.setStart(activeHit.node, activeHit.start);
        activeRange.setEnd(activeHit.node, activeHit.start + termLen);
        HL.set("gen-find-all", new HLClass(...allRanges));
        HL.set("gen-find-active", new HLClass(activeRange));
      } catch (_) { /* Highlight API unsupported */ }
    }

    // For scroll: walk up from the text node to the nearest block-level ancestor.
    const scrollTarget = nearestBlock(activeHit.node.parentElement, container);
    if (!scrollTarget) return clearGenHighlights;
    const containerRect = container.getBoundingClientRect();
    const targetRect = scrollTarget.getBoundingClientRect();
    container.scrollTop += targetRect.top - containerRect.top - 16;

    return clearGenHighlights;
  }, [findMatch]);
  const [view, setView] = useState<View>("preview");
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
          <div className="paneBody genEdit adminCompact" ref={setScroll}>
            <BlockEditor body={note.body} onChange={onBody} dupeFlags={dupeFlags} noteId={note.id} onAssetChange={onAssetChange} />
          </div>
        ) : (
          <div className="paneBody adminCompact" ref={setScroll}>
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
