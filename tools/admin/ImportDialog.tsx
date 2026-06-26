/**
 * Import-from-txt (PLAN §7). Paste raw indented notes (fence code with ```), pick the
 * source language, and the deterministic parser (tools/convert/parse.ts, via /api/import)
 * builds blocks. The dialog shows the source and the generated note SIDE BY SIDE:
 *   - Source (left): raw notes, editable — re-parses as you type.
 *   - Generated (right): a Preview (real renderer) or an editable JSON view of the blocks,
 *     validated live against the block schema. Edits to either side flow into what's inserted.
 * No model is called — any AI enrichment happens externally, by hand, on the JSON.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { BlockNodeSchema, type BlockNode, type Note } from "../../src/lib/schema.ts";
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

const countBlocks = (body: BlockNode[]): number =>
  body.reduce(
    (n, node) => n + 1 + (node.type === "outline" && node.children ? countBlocks(node.children) : 0),
    0,
  );

export function ImportDialog({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (body: BlockNode[], mode: "append" | "replace") => void;
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
  const apply = (mode: "append" | "replace") => {
    if (!ready || !body) return;
    onResult(body, mode);
    onClose();
  };

  const status = busy
    ? "parsing…"
    : importError
      ? "parse error"
      : jsonError
        ? "JSON invalid"
        : body && body.length
          ? `${countBlocks(body)} blocks`
          : "paste to preview";

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal importModal" onClick={(e) => e.stopPropagation()}>
        <div className="importHead">
          <h2>Import raw notes</h2>
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
          <span className="spacer" />
          <span className="hint">{status}</span>
        </div>

        <div className="importPanes">
          <div className="importPane">
            <div className="paneHead">Source</div>
            <textarea
              className="mono importArea"
              placeholder={"Paste raw notes here…\n\nTopic\n    Subtopic\n    ```python\n    print('x')\n    ```"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {importError && <div className="paneError">{importError}</div>}
          </div>

          <div className="importPane">
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
                className="mono importArea"
                spellCheck={false}
                placeholder="Generated block JSON appears here once you paste source."
                value={jsonText}
                onChange={(e) => onJsonChange(e.target.value)}
              />
            ) : (
              <div className="paneBody">
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
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button disabled={!ready} onClick={() => apply("append")}>
            Append to note
          </button>
          <button className="primary" disabled={!ready} onClick={() => apply("replace")}>
            Replace body
          </button>
        </div>
      </div>
    </div>
  );
}
