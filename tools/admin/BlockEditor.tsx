/**
 * Visual block editor for a note's `body` (PLAN §7). Edits the block-tree through the
 * positional-path ops in tree-ops.ts. Every node carries a toolbar (move/indent/add/delete);
 * outline nodes nest their children recursively. A ⚠ shows when a node's text/code is
 * duplicated elsewhere (§7a), linking to the other locations.
 */
import { useRef } from "react";
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
  indent,
  insertAfter,
  move,
  outdent,
  removeAt,
  replaceAt,
} from "./tree-ops.ts";

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

export function BlockEditor({
  body,
  onChange,
  dupeFlags,
  noteId,
}: {
  body: BlockNode[];
  onChange: (body: BlockNode[]) => void;
  dupeFlags: Map<string, DupeGroup>;
  noteId: string;
}) {
  const apply: Apply = (fn) => onChange(fn(body));
  return (
    <div className="blocks">
      {body.length === 0 && <p className="hint">No blocks yet. Add one below, or import raw notes.</p>}
      {body.map((node, i) => (
        <NodeEditor
          key={i}
          node={node}
          path={String(i)}
          apply={apply}
          dupeFlags={dupeFlags}
          noteId={noteId}
        />
      ))}
      <AddBar onAdd={(t) => onChange(appendTop(body, newNode(t)))} label="Add block" />
    </div>
  );
}

function NodeEditor({
  node,
  path,
  apply,
  dupeFlags,
  noteId,
}: {
  node: BlockNode;
  path: string;
  apply: Apply;
  dupeFlags: Map<string, DupeGroup>;
  noteId: string;
}) {
  const update = (next: BlockNode) => apply((b) => replaceAt(b, path, next));
  const dupe = dupeFlags.get(path);

  return (
    <div className={`node node-${node.type}`}>
      <div className="nodeBar">
        <span className="nodeType">{node.type}</span>
        {dupe && (
          <span className="dupe" title={dupe.occurrences.map((o) => `${o.noteId}#n${o.path}`).join("\n")}>
            ⚠ duplicate ×{dupe.occurrences.length}
          </span>
        )}
        <span className="spacer" />
        <button title="Move up" onClick={() => apply((b) => move(b, path, -1))}>↑</button>
        <button title="Move down" onClick={() => apply((b) => move(b, path, 1))}>↓</button>
        <button title="Indent (into previous)" onClick={() => apply((b) => indent(b, path))}>→</button>
        <button title="Outdent" onClick={() => apply((b) => outdent(b, path))}>←</button>
        <button className="danger" title="Delete" onClick={() => apply((b) => removeAt(b, path))}>✕</button>
      </div>

      <NodeFields node={node} update={update} noteId={noteId} />

      {node.type === "outline" && (
        <div className="children">
          {node.children?.map((child, i) => (
            <NodeEditor
              key={i}
              node={child}
              path={`${path}.${i}`}
              apply={apply}
              dupeFlags={dupeFlags}
              noteId={noteId}
            />
          ))}
          <AddBar onAdd={(t) => apply((b) => appendChild(b, path, newNode(t)))} label="Add child" />
        </div>
      )}

      <AddBar onAdd={(t) => apply((b) => insertAfter(b, path, newNode(t)))} label="Add after" subtle />
    </div>
  );
}

function NodeFields({
  node,
  update,
  noteId,
}: {
  node: BlockNode;
  update: (n: BlockNode) => void;
  noteId: string;
}) {
  switch (node.type) {
    case "outline":
      return <OutlineFields node={node} update={update} />;
    case "code":
      return <CodeFields node={node} update={update} />;
    case "callout":
      return <CalloutFields node={node} update={update} />;
    case "text":
      return <TextFields node={node} update={update} />;
    case "table":
      return <TableFields node={node} update={update} />;
    case "flashcard":
      return <FlashcardFields node={node} update={update} />;
    case "image":
      return <ImageFields node={node} update={update} noteId={noteId} />;
    case "link":
      return <LinkFields node={node} update={update} />;
  }
}

function OutlineFields({ node, update }: { node: OutlineNode; update: (n: BlockNode) => void }) {
  return (
    <div className="fields">
      <textarea
        className="autoGrow"
        rows={1}
        placeholder="Outline text"
        value={node.text}
        onChange={(e) => update({ ...node, text: e.target.value })}
      />
      <textarea
        rows={2}
        placeholder="Note (optional aside)"
        value={node.note ?? ""}
        onChange={(e) => update({ ...node, note: e.target.value || undefined })}
      />
      <label className="topicToggle" title="Mark as a standalone topic — search results land on the nearest topic">
        <input
          type="checkbox"
          checked={node.role === "topic"}
          onChange={(e) => update({ ...node, role: e.target.checked ? "topic" : undefined })}
        />
        <span>Topic (standalone unit)</span>
      </label>
    </div>
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
    <div className="fields">
      <div className="row">
        <input
          className="lang"
          placeholder="lang"
          value={node.lang}
          onChange={(e) => update({ ...node, lang: e.target.value })}
        />
        <input
          placeholder="highlight lines (e.g. 2,5)"
          value={(node.highlight ?? []).join(", ")}
          onChange={(e) => setHighlight(e.target.value)}
        />
      </div>
      <textarea
        className="mono"
        rows={6}
        placeholder="code"
        value={node.code}
        onChange={(e) => update({ ...node, code: e.target.value })}
      />
    </div>
  );
}

function CalloutFields({ node, update }: { node: CalloutNode; update: (n: BlockNode) => void }) {
  return (
    <div className="fields">
      <select value={node.variant} onChange={(e) => update({ ...node, variant: e.target.value as CalloutVariant })}>
        {VARIANTS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <textarea
        rows={2}
        placeholder="Callout text"
        value={node.text}
        onChange={(e) => update({ ...node, text: e.target.value })}
      />
    </div>
  );
}

function TextFields({ node, update }: { node: TextNode; update: (n: BlockNode) => void }) {
  return (
    <div className="fields">
      <textarea
        rows={4}
        placeholder="Prose paragraph(s). Blank line = new paragraph."
        value={node.text}
        onChange={(e) => update({ ...node, text: e.target.value })}
      />
    </div>
  );
}

function FlashcardFields({ node, update }: { node: FlashcardNode; update: (n: BlockNode) => void }) {
  return (
    <div className="fields">
      <textarea
        rows={2}
        placeholder="Question"
        value={node.q}
        onChange={(e) => update({ ...node, q: e.target.value })}
      />
      <textarea
        rows={2}
        placeholder="Answer"
        value={node.a}
        onChange={(e) => update({ ...node, a: e.target.value })}
      />
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
    <div className="fields tableEditor">
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
}: {
  node: ImageNode;
  update: (n: BlockNode) => void;
  noteId: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const dataBase64 = await fileToBase64(file);
    const { src } = await api.upload(noteId, file.name, dataBase64);
    update({ ...node, src });
  };

  return (
    <div className="fields">
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
      <input
        placeholder="alt text"
        value={node.alt}
        onChange={(e) => update({ ...node, alt: e.target.value })}
      />
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
    <div className="fields">
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

function AddBar({
  onAdd,
  label,
  subtle,
}: {
  onAdd: (t: BlockNode["type"]) => void;
  label: string;
  subtle?: boolean;
}) {
  return (
    <div className={`addBar ${subtle ? "subtle" : ""}`}>
      <span className="addLabel">{label}:</span>
      {TYPES.map((t) => (
        <button key={t} className="tiny" onClick={() => onAdd(t)}>
          {t}
        </button>
      ))}
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
