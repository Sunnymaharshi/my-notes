/**
 * The "Source" half of the studio — a paste/import scratch area. Paste raw indented notes
 * (fence code with ```), pick the source language, and the deterministic parser
 * (tools/convert/parse.ts, via /api/import) builds blocks. No model is called; any AI
 * enrichment happens externally, by hand, on the JSON.
 *
 * Always live: the parse flows straight into the note body as you type, so the Generated
 * pane (Preview/Edit/JSON) renders it with no extra click — including re-pastes after you've
 * tweaked blocks in the Edit tab. The replace is safe because the Source box is empty on
 * open (App keys this pane by note id), so it never fires from merely opening a note: only
 * deliberate typing/pasting here replaces the body, and ⌘Z undoes it if you didn't mean to.
 */
import { useEffect, useRef, useState, type Ref } from "react";
import type { BlockNode } from "../../src/lib/schema.ts";
import { api } from "./api.ts";

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

/** Where blocks land in the current note. */
export type InsertTarget =
  | { mode: "append" }
  | { mode: "replace" }
  | { mode: "before"; path: string }
  | { mode: "after"; path: string }
  | { mode: "child"; path: string };

const countBlocks = (body: BlockNode[]): number =>
  body.reduce(
    (n, node) => n + 1 + (node.type === "outline" && node.children ? countBlocks(node.children) : 0),
    0,
  );

export function SourcePane({
  onResult,
  textareaRef,
}: {
  onResult: (body: BlockNode[], target: InsertTarget) => void;
  /** Source textarea ref, for optional scroll-sync with the Generated pane. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState("");
  const [ext, setExt] = useState<string>(".txt");
  const [body, setBody] = useState<BlockNode[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep a ref to the latest onResult so the mirror effect always calls the current
  // version without adding it to deps (which would loop: onResult → setDraft → new
  // onResult prop → re-run effect with same body → setDraft → …).
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });

  // True once the textarea has held content — used to avoid clearing draft on initial mount.
  const hasHadContent = useRef(false);

  // Re-parse the source (debounced) whenever it (or the language) changes.
  useEffect(() => {
    if (!text.trim()) {
      if (hasHadContent.current) onResultRef.current([], { mode: "replace" });
      setBody(null);
      setImportError(null);
      return;
    }
    hasHadContent.current = true;
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .import(text, ext)
        .then(({ body }) => {
          if (cancelled) return;
          setBody(body);
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

  // Live: mirror the freshly-parsed source straight into the body (replace). Safe to always
  // fire because the box is empty on note-open (keyed per note in App), so this only runs from
  // deliberate typing/pasting here — never from merely opening a note. ⌘Z restores the old body
  // if it wasn't intended. Uses onResultRef so the latest callback is always invoked without
  // listing it in deps (which would loop: calling it triggers a setDraft → new onResult prop).
  useEffect(() => {
    if (!body || !body.length) return;
    onResultRef.current(body, { mode: "replace" });
  }, [body]);

  const status = busy
    ? "parsing…"
    : importError
      ? "parse error"
      : body && body.length
        ? `${countBlocks(body)} block${countBlocks(body) === 1 ? "" : "s"} live ✓`
        : "paste to render";

  return (
    <div className="importPane">
      <div className="paneHead">
        Source
        <label className="field inline" style={{ marginLeft: 8 }}>
          <span>Lang</span>
          <select value={ext} onChange={(e) => setExt(e.target.value)}>
            {EXTS.map(([e, label]) => (
              <option key={e} value={e}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <span className="hint">{status}</span>
      </div>

      <textarea
        ref={textareaRef}
        className="mono importArea"
        placeholder={"Paste raw notes here — they render live →\n\nTopic\n    Subtopic\n    ```python\n    print('x')\n    ```"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {importError && <div className="paneError">{importError}</div>}

    </div>
  );
}
