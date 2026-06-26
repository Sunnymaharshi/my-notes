/** Note envelope editor (PLAN §7): id/title/category/labels/summary/difficulty/related/draft. */
import { useState } from "react";
import type { Category, Difficulty, Note } from "../../src/lib/schema.ts";

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

export function EnvelopeForm({
  note,
  onChange,
  categories,
  allLabels,
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  categories: Category[];
  allLabels: string[];
}) {
  const [labelDraft, setLabelDraft] = useState("");

  const addLabel = (raw: string) => {
    const l = raw.trim();
    if (l && !note.labels.includes(l)) onChange({ labels: [...note.labels, l] });
    setLabelDraft("");
  };
  const removeLabel = (l: string) => onChange({ labels: note.labels.filter((x) => x !== l) });

  return (
    <div className="envelope">
      <label className="field">
        <span>Title</span>
        <input value={note.title} onChange={(e) => onChange({ title: e.target.value })} />
      </label>

      <div className="row">
        <label className="field grow">
          <span>id (folder; kebab-case)</span>
          <input value={note.id} onChange={(e) => onChange({ id: e.target.value })} />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={note.category} onChange={(e) => onChange({ category: e.target.value })}>
            {!categories.some((c) => c.id === note.category) && (
              <option value={note.category}>{note.category}</option>
            )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Difficulty</span>
          <select
            value={note.difficulty ?? ""}
            onChange={(e) => onChange({ difficulty: (e.target.value || undefined) as Difficulty | undefined })}
          >
            <option value="">—</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Summary</span>
        <textarea
          rows={2}
          value={note.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
        />
      </label>

      <div className="field">
        <span>Labels</span>
        <div className="chips">
          {note.labels.map((l) => (
            <button key={l} className="chip" onClick={() => removeLabel(l)} title="Remove">
              {l} ✕
            </button>
          ))}
        </div>
        <input
          list="all-labels"
          placeholder="Add label, Enter"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLabel(labelDraft);
            }
          }}
        />
        <datalist id="all-labels">
          {allLabels.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>

      <label className="field">
        <span>Related (note ids, comma-separated)</span>
        <input
          value={(note.related ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              related: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={note.draft}
          onChange={(e) => onChange({ draft: e.target.checked })}
        />
        <span>Draft (hidden from production build)</span>
      </label>
    </div>
  );
}
