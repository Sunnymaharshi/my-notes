/**
 * The "Source" half of the studio — a paste/import scratch area. Paste raw indented notes
 * (fence code with ```), pick the source language, and the deterministic parser
 * (tools/convert/parse.ts, via /api/import) builds blocks. Then choose where they land in
 * the note and Insert — the blocks merge into the live body (the Generated pane shows the
 * result). No model is called; any AI enrichment happens externally, by hand, on the JSON.
 *
 * Insert target supports anywhere in the tree: at the end, replacing the whole body, or
 * before / after / inside any existing node (not just top-level sections).
 */
import { useEffect, useState, type Ref } from "react";
import type { BlockNode } from "../../src/lib/schema.ts";
import { nodeLabel } from "./tree-ops.ts";
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

/** Where inserted blocks land in the current note. */
export type InsertTarget =
  | { mode: "append" }
  | { mode: "replace" }
  | { mode: "before"; path: string }
  | { mode: "after"; path: string }
  | { mode: "child"; path: string };

export type FlatNode = { path: string; depth: number; node: BlockNode };

const countBlocks = (body: BlockNode[]): number =>
  body.reduce(
    (n, node) => n + 1 + (node.type === "outline" && node.children ? countBlocks(node.children) : 0),
    0,
  );

export function SourcePane({
  targets,
  onResult,
  textareaRef,
}: {
  /** Flattened nodes of the current note, for the before/after/inside insert targets. */
  targets: FlatNode[];
  onResult: (body: BlockNode[], target: InsertTarget) => void;
  /** Source textarea ref, for optional scroll-sync with the Generated pane. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState("");
  const [ext, setExt] = useState<string>(".txt");
  const [body, setBody] = useState<BlockNode[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState<string | null>(null);

  // Position relative to a node, plus the chosen node path.
  const [pos, setPos] = useState<InsertTarget["mode"]>("append");
  const [path, setPath] = useState("");

  // Re-parse the source (debounced) whenever it (or the language) changes.
  useEffect(() => {
    if (!text.trim()) {
      setBody(null);
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

  // Keep the selected node valid as the tree changes.
  const needsNode = pos === "before" || pos === "after" || pos === "child";
  const selected = targets.find((t) => t.path === path) ?? targets[0];
  const childInvalid = pos === "child" && selected && selected.node.type !== "outline";

  const decodeTarget = (): InsertTarget => {
    if (pos === "append") return { mode: "append" };
    if (pos === "replace") return { mode: "replace" };
    return { mode: pos, path: selected?.path ?? "0" };
  };

  const ready = Boolean(body && body.length) && (!needsNode || (Boolean(selected) && !childInvalid));

  const apply = () => {
    if (!body || !ready) return;
    const n = countBlocks(body);
    onResult(body, decodeTarget());
    setInserted(`Inserted ${n} block${n === 1 ? "" : "s"} ✓`);
    setText("");
    setBody(null);
    window.setTimeout(() => setInserted(null), 2500);
  };

  const status = busy
    ? "parsing…"
    : importError
      ? "parse error"
      : inserted
        ? inserted
        : body && body.length
          ? `${countBlocks(body)} block${countBlocks(body) === 1 ? "" : "s"} parsed`
          : "paste to parse";

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
        placeholder={"Paste raw notes here…\n\nTopic\n    Subtopic\n    ```python\n    print('x')\n    ```"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {importError && <div className="paneError">{importError}</div>}

      <div className="sourceInsert">
        <label className="field inline">
          <span>Insert</span>
          <select value={pos} onChange={(e) => setPos(e.target.value as InsertTarget["mode"])}>
            <option value="append">at end of note</option>
            <option value="replace">replace whole body</option>
            <option value="before">before…</option>
            <option value="after">after…</option>
            <option value="child">inside (child of)…</option>
          </select>
        </label>
        {needsNode && (
          <select
            className="targetNode"
            value={selected?.path ?? ""}
            onChange={(e) => setPath(e.target.value)}
          >
            {targets.length === 0 && <option value="">(note is empty)</option>}
            {targets.map((t) => (
              <option key={t.path} value={t.path}>
                {" ".repeat(t.depth * 2)}
                {nodeLabel(t.node)}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button className="primary" disabled={!ready} onClick={apply}>
          Insert
        </button>
      </div>
      {childInvalid && <div className="paneError">Only outline nodes can hold children — pick before/after instead.</div>}
    </div>
  );
}
