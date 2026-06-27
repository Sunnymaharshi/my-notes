/**
 * Inline block editor for a note's `body` (PLAN §7). Reads like the preview: each block
 * renders close to its final look and is edited in place. Chrome stays out of the way —
 * a per-node control rail (drag handle · type · delete) appears on hover, and a single
 * contextual "+" inserter sits between blocks (replacing the old three add-bars and the
 * ↑↓→← buttons). Reordering/nesting is by drag; outlines also take keyboard structure
 * (Enter = new sibling, Tab/Shift-Tab = indent/outdent, Backspace on empty = delete).
 *
 * Edits go through the positional-path ops in tree-ops.ts. A ⚠ shows when a node's text/code
 * is duplicated elsewhere (§7a), linking to the other locations.
 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  BlockNode,
  CalloutNode,
  CalloutVariant,
  CodeNode,
  FlashcardNode,
  ImageNode,
  LinkNode,
  OutlineNode,
  TableNode,
  TextNode,
} from "../../src/lib/schema.ts";
import type { DupeGroup } from "../../src/lib/dupes.ts";
import { api } from "./api.ts";
import {
  appendChild,
  appendTop,
  getAt,
  indent,
  insertAfter,
  insertBefore,
  move,
  moveNode,
  outdent,
  removeAt,
  replaceAt,
} from "./tree-ops.ts";

/** DnD drop region relative to a node, derived from the pointer's position over it. */
type DropPos = "before" | "after" | "child";
const DND_MIME = "application/x-block-path";

const VARIANTS: CalloutVariant[] = ["tip", "warning", "info", "note", "gotcha"];
const TYPES: BlockNode["type"][] = ["outline", "text", "code", "callout", "table", "flashcard", "image", "link"];

function newNode(type: BlockNode["type"]): BlockNode {
  switch (type) {
    case "outline":
      return { type: "outline", text: "" };
    case "code":
      return { type: "code", lang: "text", code: "" };
    case "callout":
      return { type: "callout", variant: "note", text: "" };
    case "text":
      return { type: "text", text: "" };
    case "table":
      return { type: "table", headers: ["", ""], rows: [["", ""]] };
    case "flashcard":
      return { type: "flashcard", q: "", a: "" };
    case "image":
      return { type: "image", src: "", alt: "" };
    case "link":
      return { type: "link", url: "" };
  }
}

type Apply = (fn: (body: BlockNode[]) => BlockNode[]) => void;

/* ---- focus coordination ----
 * Structural keyboard edits (Enter/Tab/Backspace) want to land the caret on the node they
 * just created/moved. The editor publishes a requested path here; the matching textarea
 * grabs focus on the next render and clears the request. */
const FocusContext = createContext<{
  path: string | null;
  request: (p: string | null) => void;
  clear: () => void;
}>({ path: null, request: () => {}, clear: () => {} });

const partsOf = (path: string) => path.split(".").map(Number);
const join = (p: number[]) => p.join(".");
/** Sibling path with the last index shifted by delta (no bounds check). */
const sibling = (path: string, delta: number) => {
  const p = partsOf(path);
  p[p.length - 1] += delta;
  return join(p);
};
/** Path the node at `path` will occupy after an indent (becomes last child of prev sibling). */
function indentTarget(body: BlockNode[], path: string): string | null {
  const p = partsOf(path);
  const i = p[p.length - 1];
  if (i === 0) return null;
  const prevPath = join([...p.slice(0, -1), i - 1]);
  const prev = getAt(body, prevPath);
  if (prev?.type !== "outline") return null;
  return `${prevPath}.${prev.children?.length ?? 0}`;
}
/** Path the node will occupy after an outdent (sibling right after its parent). */
function outdentTarget(path: string): string | null {
  const p = partsOf(path);
  if (p.length < 2) return null;
  const parentIndex = p[p.length - 2];
  return join([...p.slice(0, -2), parentIndex + 1]);
}

/** Insert `node` at `index` within the list addressed by `parentPath` ("" = top level). */
function insertAt(body: BlockNode[], parentPath: string, index: number, node: BlockNode): BlockNode[] {
  if (parentPath === "") {
    return index >= body.length ? appendTop(body, node) : insertBefore(body, String(index), node);
  }
  const parent = getAt(body, parentPath);
  const count = parent?.type === "outline" ? parent.children?.length ?? 0 : 0;
  return index >= count ? appendChild(body, parentPath, node) : insertBefore(body, `${parentPath}.${index}`, node);
}

export function BlockEditor({
  body,
  onChange,
  dupeFlags,
  noteId,
  onAssetChange,
}: {
  body: BlockNode[];
  onChange: (body: BlockNode[]) => void;
  dupeFlags: Map<string, DupeGroup>;
  noteId: string;
  onAssetChange?: () => void;
}) {
  const apply: Apply = (fn) => onChange(fn(body));
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <FocusContext.Provider value={{ path: focus, request: setFocus, clear: () => setFocus(null) }}>
      <div className="blocks inlineBlocks">
        {body.length === 0 && (
          <p className="hint">Nothing here yet. Paste raw notes in Source, or add a block below.</p>
        )}
        <NodeList
          nodes={body}
          parentPath=""
          apply={apply}
          dupeFlags={dupeFlags}
          noteId={noteId}
          onAssetChange={onAssetChange}
        />
      </div>
    </FocusContext.Provider>
  );
}

/** A list of sibling nodes, with a "+" inserter before each and at the end. */
function NodeList({
  nodes,
  parentPath,
  apply,
  dupeFlags,
  noteId,
  onAssetChange,
}: {
  nodes: BlockNode[];
  parentPath: string;
  apply: Apply;
  dupeFlags: Map<string, DupeGroup>;
  noteId: string;
  onAssetChange?: () => void;
}) {
  const childPath = (i: number) => (parentPath ? `${parentPath}.${i}` : String(i));
  const insertHere = (index: number, t: BlockNode["type"]) =>
    apply((b) => insertAt(b, parentPath, index, newNode(t)));

  return (
    <div className="nodeList">
      {nodes.map((node, i) => (
        <div key={i}>
          <Inserter onPick={(t) => insertHere(i, t)} />
          <NodeEditor
            node={node}
            path={childPath(i)}
            apply={apply}
            dupeFlags={dupeFlags}
            noteId={noteId}
            onAssetChange={onAssetChange}
          />
        </div>
      ))}
      <Inserter end onPick={(t) => insertHere(nodes.length, t)} />
    </div>
  );
}

function NodeEditor({
  node,
  path,
  apply,
  dupeFlags,
  noteId,
  onAssetChange,
}: {
  node: BlockNode;
  path: string;
  apply: Apply;
  dupeFlags: Map<string, DupeGroup>;
  noteId: string;
  onAssetChange?: () => void;
}) {
  const update = (next: BlockNode) => apply((b) => replaceAt(b, path, next));
  const dupe = dupeFlags.get(path);
  const isTopic = node.type === "outline" && node.role === "topic";

  // Drag-and-drop reorder. The handle is the drag source; the node body is the drop target,
  // and the pointer's vertical position picks before / after (outlines also nest = child).
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const regionFor = (e: React.DragEvent): DropPos => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (node.type === "outline") return y < 0.34 ? "before" : y > 0.66 ? "after" : "child";
    return y < 0.5 ? "before" : "after";
  };
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DND_MIME, path);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropPos(regionFor(e));
  };
  const onDrop = (e: React.DragEvent) => {
    const from = e.dataTransfer.getData(DND_MIME);
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    const where = regionFor(e);
    setDropPos(null);
    apply((b) => moveNode(b, from, path, where));
  };

  return (
    <div
      className={`inode inode-${node.type}${isTopic ? " is-topic" : ""}${dropPos ? ` drop-${dropPos}` : ""}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropPos(null)}
      onDrop={onDrop}
    >
      <div className="inodeRail" contentEditable={false}>
        <span
          className="dragHandle"
          draggable
          onDragStart={onDragStart}
          title="Drag to move / nest this block"
          aria-label="Drag to move"
        >
          ⠿
        </span>
        <span className="railType">{node.type}</span>
        {dupe && (
          <span className="dupe" title={dupe.occurrences.map((o) => `${o.noteId}#n${o.path}`).join("\n")}>
            ⚠×{dupe.occurrences.length}
          </span>
        )}
        <button
          className="railDel danger"
          title="Delete block"
          onClick={() => apply((b) => removeAt(b, path))}
        >
          ✕
        </button>
      </div>

      <NodeFields node={node} path={path} apply={apply} update={update} noteId={noteId} onAssetChange={onAssetChange} />

      {node.type === "outline" && (
        <div className="children">
          <NodeList
            nodes={node.children ?? []}
            parentPath={path}
            apply={apply}
            dupeFlags={dupeFlags}
            noteId={noteId}
            onAssetChange={onAssetChange}
          />
        </div>
      )}
    </div>
  );
}

function NodeFields({
  node,
  path,
  apply,
  update,
  noteId,
  onAssetChange,
}: {
  node: BlockNode;
  path: string;
  apply: Apply;
  update: (n: BlockNode) => void;
  noteId: string;
  onAssetChange?: () => void;
}) {
  switch (node.type) {
    case "outline":
      return <OutlineFields node={node} path={path} apply={apply} update={update} />;
    case "code":
      return <CodeFields node={node} update={update} />;
    case "callout":
      return <CalloutFields node={node} update={update} />;
    case "text":
      return <TextFields node={node} path={path} update={update} />;
    case "table":
      return <TableFields node={node} update={update} />;
    case "flashcard":
      return <FlashcardFields node={node} update={update} />;
    case "image":
      return <ImageFields node={node} update={update} noteId={noteId} onAssetChange={onAssetChange} />;
    case "link":
      return <LinkFields node={node} update={update} />;
  }
}

/** Auto-growing, border-less textarea that reads like prose and honours focus requests. */
function AutoText({
  value,
  onChange,
  path,
  className,
  placeholder,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  /** When set, focus is granted to this textarea once the editor requests this path. */
  path?: string;
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const focus = useContext(FocusContext);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (path && focus.path === path && ref.current) {
      const el = ref.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      focus.clear();
    }
  });

  return (
    <textarea
      ref={ref}
      rows={1}
      className={`inlineText ${className ?? ""}`}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

function OutlineFields({
  node,
  path,
  apply,
  update,
}: {
  node: OutlineNode;
  path: string;
  apply: Apply;
  update: (n: BlockNode) => void;
}) {
  const focus = useContext(FocusContext);
  const isTopic = node.role === "topic";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Reorder among siblings (depth unchanged); Tab/Shift-Tab change depth instead.
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      focus.request(sibling(path, dir));
      apply((b) => move(b, path, dir));
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      apply((b) => insertAfter(b, path, newNode("outline")));
      focus.request(sibling(path, 1));
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      apply((b) => {
        const target = indentTarget(b, path);
        if (target) focus.request(target);
        return indent(b, path);
      });
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      const target = outdentTarget(path);
      if (target) focus.request(target);
      apply((b) => outdent(b, path));
    } else if (
      e.key === "Backspace" &&
      node.text === "" &&
      (e.currentTarget.selectionStart ?? 0) === 0 &&
      !(node.children && node.children.length)
    ) {
      e.preventDefault();
      const prev = sibling(path, -1);
      const p = partsOf(path);
      focus.request(p[p.length - 1] > 0 ? prev : join(p.slice(0, -1)) || null);
      apply((b) => removeAt(b, path));
    }
  };

  return (
    <div className="ol-fields">
      <div className="ol-row">
        <AutoText
          value={node.text}
          path={path}
          className="ol-text"
          placeholder="Outline line"
          onChange={(v) => update({ ...node, text: v })}
          onKeyDown={onKeyDown}
        />
        <button
          className={`topicBtn${isTopic ? " on" : ""}`}
          title={isTopic ? "Topic — click to unmark" : "Mark as topic (a standalone, search-deep-linkable unit)"}
          onClick={() => update({ ...node, role: isTopic ? undefined : "topic" })}
        >
          ◆ topic
        </button>
      </div>
      {(node.note !== undefined || isTopic) && (
        <AutoText
          value={node.note ?? ""}
          className="ol-note"
          placeholder="aside / note (optional)"
          onChange={(v) => update({ ...node, note: v || undefined })}
        />
      )}
    </div>
  );
}

function TextFields({
  node,
  path,
  update,
}: {
  node: TextNode;
  path: string;
  update: (n: BlockNode) => void;
}) {
  return (
    <AutoText
      value={node.text}
      path={path}
      className="prose"
      placeholder="Prose paragraph(s). Blank line = new paragraph."
      onChange={(v) => update({ ...node, text: v })}
    />
  );
}

function CodeFields({ node, update }: { node: CodeNode; update: (n: BlockNode) => void }) {
  const setHighlight = (raw: string) => {
    const nums = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1);
    update({ ...node, highlight: nums.length ? nums : undefined });
  };
  return (
    <div className="codeCard">
      <div className="codeBar">
        <input
          className="lang"
          placeholder="lang"
          value={node.lang}
          onChange={(e) => update({ ...node, lang: e.target.value })}
        />
        <input
          className="filename"
          placeholder="filename (optional)"
          value={node.filename ?? ""}
          onChange={(e) => update({ ...node, filename: e.target.value || undefined })}
        />
        <input
          className="hl"
          placeholder="highlight lines (e.g. 2,5)"
          value={(node.highlight ?? []).join(", ")}
          onChange={(e) => setHighlight(e.target.value)}
        />
      </div>
      <textarea
        className="mono codeArea"
        rows={4}
        placeholder="code"
        value={node.code}
        onChange={(e) => update({ ...node, code: e.target.value })}
      />
    </div>
  );
}

function CalloutFields({ node, update }: { node: CalloutNode; update: (n: BlockNode) => void }) {
  return (
    <div className={`calloutCard cv-${node.variant}`}>
      <select
        className="cvSelect"
        value={node.variant}
        onChange={(e) => update({ ...node, variant: e.target.value as CalloutVariant })}
      >
        {VARIANTS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <AutoText
        value={node.text}
        className="cvText"
        placeholder="Callout text"
        onChange={(v) => update({ ...node, text: v })}
      />
    </div>
  );
}

function FlashcardFields({ node, update }: { node: FlashcardNode; update: (n: BlockNode) => void }) {
  return (
    <div className="cardCard">
      <div className="cardSide">
        <span className="cardLabel">Q</span>
        <AutoText value={node.q} placeholder="Question" onChange={(v) => update({ ...node, q: v })} />
      </div>
      <div className="cardSide">
        <span className="cardLabel">A</span>
        <AutoText value={node.a} placeholder="Answer" onChange={(v) => update({ ...node, a: v })} />
      </div>
    </div>
  );
}

function TableFields({ node, update }: { node: TableNode; update: (n: BlockNode) => void }) {
  const setHeader = (i: number, v: string) => {
    const headers = [...node.headers];
    headers[i] = v;
    update({ ...node, headers });
  };
  const setCell = (r: number, c: number, v: string) => {
    const rows = node.rows.map((row) => [...row]);
    rows[r][c] = v;
    update({ ...node, rows });
  };
  const addCol = () =>
    update({ ...node, headers: [...node.headers, ""], rows: node.rows.map((r) => [...r, ""]) });
  const addRow = () => update({ ...node, rows: [...node.rows, node.headers.map(() => "")] });
  const delCol = (c: number) =>
    update({
      ...node,
      headers: node.headers.filter((_, i) => i !== c),
      rows: node.rows.map((r) => r.filter((_, i) => i !== c)),
    });
  const delRow = (r: number) => update({ ...node, rows: node.rows.filter((_, i) => i !== r) });

  return (
    <div className="tableEditor">
      <table>
        <thead>
          <tr>
            {node.headers.map((h, c) => (
              <th key={c}>
                <input value={h} placeholder={`col ${c + 1}`} onChange={(e) => setHeader(c, e.target.value)} />
                <button className="tiny danger" title="Delete column" onClick={() => delCol(c)}>✕</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <input value={cell} onChange={(e) => setCell(r, c, e.target.value)} />
                </td>
              ))}
              <td>
                <button className="tiny danger" title="Delete row" onClick={() => delRow(r)}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="tiny" onClick={addCol}>+ column</button>
        <button className="tiny" onClick={addRow}>+ row</button>
      </div>
    </div>
  );
}

function ImageFields({
  node,
  update,
  noteId,
  onAssetChange,
}: {
  node: ImageNode;
  update: (n: BlockNode) => void;
  noteId: string;
  onAssetChange?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const dataBase64 = await fileToBase64(file);
    const { src } = await api.upload(noteId, file.name, dataBase64);
    update({ ...node, src });
    onAssetChange?.();
  };

  return (
    <div className="imageCard">
      {node.src && <img className="imagePreview" src={`/content/notes/${noteId}/${node.src}`} alt={node.alt} />}
      <div className="row">
        <input
          placeholder="src (e.g. diagram.png)"
          value={node.src}
          onChange={(e) => update({ ...node, src: e.target.value })}
        />
        <button className="tiny" onClick={() => fileRef.current?.click()}>Upload…</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>
      <input placeholder="alt text" value={node.alt} onChange={(e) => update({ ...node, alt: e.target.value })} />
      <input
        placeholder="caption (optional)"
        value={node.caption ?? ""}
        onChange={(e) => update({ ...node, caption: e.target.value || undefined })}
      />
    </div>
  );
}

function LinkFields({ node, update }: { node: LinkNode; update: (n: BlockNode) => void }) {
  return (
    <div className="linkCard">
      <span className="linkIcon">🔗</span>
      <input
        placeholder="url (e.g. https://github.com/…)"
        value={node.url}
        onChange={(e) => update({ ...node, url: e.target.value })}
      />
      <input
        placeholder="label (optional; defaults to the url)"
        value={node.text ?? ""}
        onChange={(e) => update({ ...node, text: e.target.value || undefined })}
      />
    </div>
  );
}

/** A slim hover-revealed "+" between blocks that opens a compact block-type menu. */
function Inserter({ onPick, end }: { onPick: (t: BlockNode["type"]) => void; end?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`inserter${end ? " end" : ""}${open ? " open" : ""}`}>
      {open ? (
        <div className="inserterMenu" onMouseLeave={() => setOpen(false)}>
          {TYPES.map((t) => (
            <button
              key={t}
              className="tiny"
              onClick={() => {
                onPick(t);
                setOpen(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      ) : (
        <button className="inserterPlus" title="Insert a block here" onClick={() => setOpen(true)}>
          +
        </button>
      )}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
