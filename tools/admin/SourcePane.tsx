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
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { BlockNode } from "../../src/lib/schema.ts";
import { api } from "./api.ts";
import { clearGenHighlights, type FindMatch } from "./find-utils.ts";

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

/** Extract a `~~~ Title` or `~~~ id | Title` divider from the first matching line.
 *  Strips any leading comment prefix (# // -- * """ ''') and removes that line from the text. */
function extractDivider(raw: string): { title: string; clean: string } | null {
  const DIVIDER = /^[^\n]*~{3,}[ \t]*(.+?)[ \t]*$/m;
  const m = raw.match(DIVIDER);
  if (!m) return null;
  let title = m[1].trim().replace(/\s*(?:"""|'''|\*\/)\s*$/, "").trim();
  if (title.includes("|")) title = title.split("|").slice(1).join("|").trim();
  if (!title) return null;
  const clean = raw.slice(0, m.index).replace(/\n$/, "") +
    raw.slice((m.index ?? 0) + m[0].length).replace(/^\n/, "");
  return { title, clean };
}

/** Escape text for safe insertion into the mirror div via dangerouslySetInnerHTML. */
function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build highlight HTML for the mirror overlay: all matches marked, active match marked .active. */
function buildMirrorHtml(text: string, matches: number[], termLen: number, activeIdx: number): string {
  if (!matches.length || !termLen) return escHtml(text);
  let out = "";
  let pos = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const end = start + termLen;
    out += escHtml(text.slice(pos, start));
    out += `<mark class="${i === activeIdx ? "active" : ""}">${escHtml(text.slice(start, end))}</mark>`;
    pos = end;
  }
  out += escHtml(text.slice(pos));
  return out;
}

export function SourcePane({
  onResult,
  onTitle,
  textareaRef,
  onFindMatch,
}: {
  onResult: (body: BlockNode[], target: InsertTarget) => void;
  /** Called with an extracted `~~~ Title` when the paste contains one. */
  onTitle?: (title: string) => void;
  /** Source textarea ref, for optional scroll-sync with the Generated pane. */
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Called with the current find term+idx (or null when find closes) for right-pane sync. */
  onFindMatch?: (match: FindMatch | null) => void;
}) {
  const [text, setText] = useState("");
  const [ext, setExt] = useState<string>(() => localStorage.getItem("admin:sourceLang") ?? ".txt");
  const [body, setBody] = useState<BlockNode[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Find bar state
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const localTaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Merge external textareaRef (scroll-sync) with our local ref (find/mirror sync).
  const setTaRef = useCallback((el: HTMLTextAreaElement | null) => {
    (localTaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    if (!textareaRef) return;
    if (typeof textareaRef === "function") textareaRef(el);
    else (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  }, [textareaRef]);

  // All match start-positions in source text.
  const matches = useMemo(() => {
    if (!findTerm.trim() || !text) return [];
    const lower = text.toLowerCase();
    const term = findTerm.toLowerCase();
    const out: number[] = [];
    let i = lower.indexOf(term);
    while (i !== -1) { out.push(i); i = lower.indexOf(term, i + 1); }
    return out;
  }, [text, findTerm]);

  const clampedIdx = matches.length ? Math.min(findIdx, matches.length - 1) : 0;

  // Scroll the textarea to the active match without stealing focus from the find input.
  // The mirror overlay shows the visual highlight; we only need to scroll the textarea.
  useEffect(() => {
    if (!findOpen || !matches.length || !localTaRef.current) return;
    const ta = localTaRef.current;
    const start = matches[clampedIdx];
    // setSelectionRange works without focus; visible highlight comes from the mirror overlay.
    ta.setSelectionRange(start, start + findTerm.length);
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    const linesAbove = text.slice(0, start).split("\n").length - 1;
    const targetScroll = Math.max(0, (linesAbove - 2) * lineHeight);
    ta.scrollTop = targetScroll;
    // Keep mirror in sync with the programmatic scroll.
    if (mirrorRef.current) mirrorRef.current.scrollTop = targetScroll;
  }, [clampedIdx, matches, findOpen, findTerm, text]);

  // Notify parent of current match so the Generated pane can sync its scroll.
  useEffect(() => {
    if (findOpen && findTerm.trim() && matches.length) {
      onFindMatch?.({ term: findTerm, idx: clampedIdx });
    } else {
      onFindMatch?.(null);
    }
  }, [findTerm, clampedIdx, findOpen, matches.length, onFindMatch]);

  const openFind = () => {
    setFindOpen(true);
    setFindIdx(0);
    const sel = localTaRef.current;
    if (sel) {
      const selected = text.slice(sel.selectionStart, sel.selectionEnd).trim();
      if (selected && !selected.includes("\n")) setFindTerm(selected);
    }
    setTimeout(() => findInputRef.current?.select(), 0);
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindTerm("");
    onFindMatch?.(null);
    // Call synchronously — don't rely on React state propagation + effect scheduling,
    // which is too slow and leaves highlights visible after the bar closes.
    clearGenHighlights();
    localTaRef.current?.focus();
  };

  const navigate = (dir: 1 | -1) => {
    if (!matches.length) return;
    setFindIdx((i) => (i + dir + matches.length) % matches.length);
  };

  // Stable refs so parse/title effects don't re-run on every parent render.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  const onTitleRef = useRef(onTitle);
  useEffect(() => { onTitleRef.current = onTitle; });

  // True once the textarea has held content — avoids clearing draft on initial mount.
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
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, ext]);

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

  const showMirror = findOpen && !!findTerm.trim() && matches.length > 0;
  const mirrorHtml = showMirror
    ? buildMirrorHtml(text, matches, findTerm.length, clampedIdx)
    : "";

  return (
    <div className="importPane">
      <div className="paneHead">
        Source
        <label className="field inline" style={{ marginLeft: 8 }}>
          <span>Lang</span>
          <select value={ext} onChange={(e) => { setExt(e.target.value); localStorage.setItem("admin:sourceLang", e.target.value); }}>
            {EXTS.map(([e, label]) => (
              <option key={e} value={e}>{label}</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <span className="hint">{status}</span>
        <button className="tiny" title="Find in source (⌘F)" onClick={openFind}>⌕</button>
      </div>

      {findOpen && (
        <div className="findBar">
          <input
            ref={findInputRef}
            className="findInput"
            placeholder="Find in source…"
            value={findTerm}
            onChange={(e) => { setFindTerm(e.target.value); setFindIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") closeFind();
            }}
          />
          <span className="findCount">
            {findTerm.trim()
              ? matches.length ? `${clampedIdx + 1} / ${matches.length}` : "no matches"
              : ""}
          </span>
          <button className="tiny" onClick={() => navigate(-1)} disabled={!matches.length} title="Previous (Shift+Enter)">↑</button>
          <button className="tiny" onClick={() => navigate(1)} disabled={!matches.length} title="Next (Enter)">↓</button>
          <button className="tiny" onClick={closeFind} title="Close (Esc)">✕</button>
        </div>
      )}

      {/* sourceWrap: positions the highlight mirror behind the textarea */}
      <div className="sourceWrap">
        {showMirror && (
          <div
            ref={mirrorRef}
            className="sourceMirror mono"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: mirrorHtml }}
          />
        )}
        <textarea
          ref={setTaRef}
          className={`mono importArea${showMirror ? " findActive" : ""}`}
          placeholder={"Paste raw notes here — they render live →\n\nTopic\n    Subtopic\n    ```python\n    print('x')\n    ```"}
          value={text}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onPaste={() => {
            // Browser scrolls to cursor (end of paste) by default — reset to top instead.
            requestAnimationFrame(() => {
              if (localTaRef.current) localTaRef.current.scrollTop = 0;
            });
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "f") {
              e.preventDefault();
              openFind();
            }
          }}
          onChange={(e) => {
            let val = e.target.value;
            const extracted = extractDivider(val);
            if (extracted) {
              val = extracted.clean;
              onTitleRef.current?.(extracted.title);
            }
            setText(val);
          }}
        />
      </div>

      {importError && <div className="paneError">{importError}</div>}
    </div>
  );
}
