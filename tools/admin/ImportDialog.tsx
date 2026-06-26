/**
 * Import-from-txt (PLAN §7). Paste raw indented notes (fence code with ```), pick the
 * source language, and the deterministic parser (tools/convert/parse.ts, via /api/import)
 * builds blocks. The dialog shows the source and the generated note SIDE BY SIDE:
 *   - Source (left): raw notes, editable — re-parses as you type.
 *   - Generated (right): a Preview (real renderer) or an editable JSON view of the blocks,
 *     validated live against the block schema. Edits to either side flow into what's inserted.
 * No model is called — any AI enrichment happens externally, by hand, on the JSON.
 *
 * Two presentations from the same body:
 *   - modal (default): centered overlay, closes after an insert.
 *   - docked (`docked`): a persistent left pane next to the editor, so you can paste →
 *     insert → paste again without reopening. Insert never closes it.
 * Insert target (`onResult`): append to the end, replace the body, or nest under a section.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  BlockNodeSchema,
  CURRENT_SCHEMA_VERSION,
  type BlockNode,
  type Note,
} from "../../src/lib/schema.ts";
import { api } from "./api.ts";
import { Preview } from "./Preview.tsx";

const EXTS = [
  [".txt", "text"],
  [".py", "python"],
  [".js", "javascript"],
  [".ts", "typescript"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
  [".sql", "sql"],
  [".sh", "bash"],
] as const;

const BodySchema = z.array(BlockNodeSchema);

/** Where inserted blocks land in the current note. */
export type InsertTarget =
  | { mode: "append" }
  | { mode: "replace" }
  | { mode: "section"; path: string };

const countBlocks = (body: BlockNode[]): number =>
  body.reduce(
    (n, node) => n + 1 + (node.type === "outline" && node.children ? countBlocks(node.children) : 0),
    0,
  );

export function ImportDialog({
  onClose,
  onResult,
  sections,
  docked = false,
  embedded = false,
}: {
  onClose: () => void;
  onResult: (body: BlockNode[], target: InsertTarget) => void;
  /** Top-level sections of the current note, for the "nest under…" insert target. */
  sections: { path: string; label: string }[];
  docked?: boolean;
  /** Render just the inner content with no wrapper (used when embedded in the editor layout). */
  embedded?: boolean;
}) {
  const [text, setText] = useState("");
  const [ext, setExt] = useState<string>(".txt");
  // `body` is the validated working tree used by both the preview and insert.
  const [body, setBody] = useState<BlockNode[] | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"preview" | "json">("preview");
  // Insert target, encoded: "append" | "replace" | "section:<path>".
  const [target, setTarget] = useState("append");
  const [inserted, setInserted] = useState<string | null>(null);

  // Drag-to-resize: leftPct is the source pane width as a percentage of the container.
  const [leftPct, setLeftPct] = useState(50);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Sync scroll between source textarea and generated pane.
  const [syncScroll, setSyncScroll] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const generatedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!syncScroll) return;
    const src = sourceRef.current;
    const gen = generatedRef.current;
    if (!src || !gen) return;
    let locked = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => {
      if (locked) return;
      locked = true;
      const max = from.scrollHeight - from.clientHeight;
      const ratio = max > 0 ? from.scrollTop / max : 0;
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => { locked = false; });
    };
    const onSrc = () => mirror(src, gen);
    const onGen = () => mirror(gen, src);
    src.addEventListener("scroll", onSrc);
    gen.addEventListener("scroll", onGen);
    return () => {
      src.removeEventListener("scroll", onSrc);
      gen.removeEventListener("scroll", onGen);
    };
  }, [syncScroll]);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (mv: MouseEvent) => {
      if (!dragging.current || !panesRef.current) return;
      const rect = panesRef.current.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((mv.clientX - rect.left) / rect.width) * 100));
      setLeftPct(pct);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Set the working tree + mirror it into the editable JSON pane.
  const setGenerated = (next: BlockNode[]) => {
    setBody(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError(null);
  };
  const setGeneratedRef = useRef(setGenerated);
  setGeneratedRef.current = setGenerated;

  // Re-parse the source (debounced) whenever it (or the language) changes. This overwrites
  // manual JSON edits — editing the source is an explicit "re-generate".
  useEffect(() => {
    if (!text.trim()) {
      setBody(null);
      setJsonText("");
      setJsonError(null);
      setImportError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .import(text, ext)
        .then(({ body }) => {
          if (cancelled) return;
          setGeneratedRef.current(body);
          setImportError(null);
        })
        .catch((e) => !cancelled && setImportError((e as Error).message))
        .finally(() => !cancelled && setBusy(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, ext]);

  // Hand-edits to the JSON pane: parse + validate against the block schema. Only a valid
  // tree updates the preview / what gets inserted; otherwise show the error and block insert.
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
    setBody(parsed.data);
  };

  const previewNote: Note = useMemo(
    () => ({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: "import-preview",
      title: "Import preview",
      category: "preview",
      labels: [],
      summary: "",
      updated: "2026-01-01",
      draft: true,
      body: body ?? [],
    }),
    [body],
  );

  const ready = Boolean(body && body.length && !jsonError);
  const decodeTarget = (): InsertTarget =>
    target === "replace"
      ? { mode: "replace" }
      : target.startsWith("section:")
        ? { mode: "section", path: target.slice("section:".length) }
        : { mode: "append" };

  const apply = () => {
    if (!ready || !body) return;
    const n = countBlocks(body);
    onResult(body, decodeTarget());
    if (docked) {
      // Stay open for the next paste; clear the source so it's ready to reuse.
      setInserted(`Inserted ${n} block${n === 1 ? "" : "s"} ✓`);
      setText("");
      window.setTimeout(() => setInserted(null), 2500);
    } else {
      onClose();
    }
  };

  const status = busy
    ? "parsing…"
    : importError
      ? "parse error"
      : jsonError
        ? "JSON invalid"
        : inserted
          ? inserted
          : body && body.length
            ? `${countBlocks(body)} blocks`
            : "paste to preview";

  const inner = (
    <>
      <div className="importHead">
        <h2>{docked || embedded ? "Paste notes" : "Import raw notes"}</h2>
        <label className="field inline">
          <span>Language</span>
          <select value={ext} onChange={(e) => setExt(e.target.value)}>
            {EXTS.map(([e, label]) => (
              <option key={e} value={e}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="toggle"
          data-on={syncScroll}
          title="Sync scroll between source and generated"
          onClick={() => setSyncScroll((v) => !v)}
        >
          ⇅ scroll: {syncScroll ? "linked" : "free"}
        </button>
        <span className="spacer" />
        <span className="hint">{status}</span>
        {docked && (
          <button className="tiny" title="Close paste pane" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <div className={`importPanes ${docked ? "dock" : ""}`} ref={panesRef}>
        <div className="importPane" style={docked ? undefined : { width: `${leftPct}%` }}>
          <div className="paneHead">Source</div>
          <textarea
            ref={sourceRef}
            className="mono importArea"
            placeholder={"Paste raw notes here...\n\nTopic\n    Subtopic\n    ```python\n    print('x')\n    ```"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {importError && <div className="paneError">{importError}</div>}
        </div>

        {!docked && (
          <div className="paneDivider" onMouseDown={onDividerMouseDown} title="Drag to resize" />
        )}

        <div className="importPane" style={docked ? undefined : { width: `${100 - leftPct}%` }}>
          <div className="paneHead">
            Generated
            <span className="spacer" />
            <button className={`tiny ${view === "preview" ? "primary" : ""}`} onClick={() => setView("preview")}>
              Preview
            </button>
            <button className={`tiny ${view === "json" ? "primary" : ""}`} onClick={() => setView("json")}>
              JSON (editable)
            </button>
          </div>

          {view === "json" ? (
            <textarea
              ref={generatedRef as unknown as React.RefObject<HTMLTextAreaElement>}
              className="mono importArea"
              spellCheck={false}
              placeholder="Generated block JSON appears here once you paste source."
              value={jsonText}
              onChange={(e) => onJsonChange(e.target.value)}
            />
          ) : (
            <div ref={generatedRef as unknown as React.RefObject<HTMLDivElement>} className="paneBody">
              {!body?.length && <p className="hint">Nothing parsed yet.</p>}
              {body?.length ? <Preview note={previewNote} /> : null}
            </div>
          )}
          {jsonError && <div className="paneError">{jsonError}</div>}
        </div>
      </div>

      <p className="hint">
        Indentation becomes the outline tree; <code>```</code> fences become code blocks. Edit
        the source <em>or</em> the JSON until it looks right (the other view follows), then
        insert — and enrich further in the editor.
      </p>

      <div className="modalActions">
        {!docked && !embedded && <button onClick={onClose}>Cancel</button>}
        <label className="field inline">
          <span>Insert</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="append">at end of note</option>
            <option value="replace">replace whole body</option>
            {sections.map((s) => (
              <option key={s.path} value={`section:${s.path}`}>
                under: {s.label || `section ${Number(s.path) + 1}`}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button className="primary" disabled={!ready} onClick={apply}>
          Insert
        </button>
      </div>
    </>
  );

  if (embedded) return <>{inner}</>;
  if (docked) return <aside className="importDock">{inner}</aside>;
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal importModal" onClick={(e) => e.stopPropagation()}>
        {inner}
      </div>
    </div>
  );
}
