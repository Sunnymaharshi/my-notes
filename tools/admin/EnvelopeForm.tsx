/** Note envelope editor (PLAN §7): id/title/category/labels/summary/difficulty/related/draft. */
import { useEffect, useState } from "react";
import type { Category, Difficulty, Domain, Note } from "../../src/lib/schema.ts";
import { api } from "./api.ts";

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

/** View + delete a note's colocated asset files. Keyed on the on-disk (saved) id so the
 *  /content image URLs resolve; hidden for unsaved notes (no folder yet). */
function AssetManager({ savedId, assetVer }: { savedId: string | null; assetVer: number }) {
  const [assets, setAssets] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!savedId) return setAssets([]);
    let cancelled = false;
    api
      .assets(savedId)
      .then(({ assets }) => !cancelled && setAssets(assets))
      .catch(() => !cancelled && setAssets([]));
    return () => {
      cancelled = true;
    };
  }, [savedId, tick, assetVer]);

  if (!savedId) return null;

  const del = async (f: string) => {
    if (!window.confirm(`Delete asset "${f}"? This removes the file from the note folder.`)) return;
    const { assets } = await api.deleteAsset(savedId, f);
    setAssets(assets);
  };

  return (
    <div className="field">
      <span>
        Assets
        <button type="button" className="tiny" title="Refresh" onClick={() => setTick((t) => t + 1)} style={{ marginLeft: 6 }}>
          ↻
        </button>
      </span>
      {assets.length === 0 ? (
        <p className="hint">No files uploaded. Upload images from an image block.</p>
      ) : (
        <div className="assetGrid">
          {assets.map((f) => (
            <div className="assetItem" key={f}>
              <img src={`/content/notes/${savedId}/${f}`} alt={f} loading="lazy" />
              <span className="assetName" title={f}>{f}</span>
              <button type="button" className="tiny danger" title="Delete file" onClick={() => del(f)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EnvelopeForm({
  note,
  onChange,
  categories,
  domains,
  allLabels,
  noteIds,
  onAddCategory,
  savedId,
  assetVer,
}: {
  note: Note;
  onChange: (patch: Partial<Note>) => void;
  categories: Category[];
  domains: Domain[];
  allLabels: string[];
  /** All existing note ids, for the Related picker + dangling-ref check. */
  noteIds: string[];
  /** Open the catalog dialog to add a category without leaving the form. */
  onAddCategory: () => void;
  /** The on-disk id of the loaded note (null for a new/unsaved note), for asset URLs. */
  savedId: string | null;
  /** Bumped by the parent when assets change (upload), to refresh the panel. */
  assetVer: number;
}) {
  const [labelDraft, setLabelDraft] = useState("");
  const [relatedDraft, setRelatedDraft] = useState("");
  const idSet = new Set(noteIds);

  const related = note.related ?? [];
  const addRelated = (raw: string) => {
    const r = raw.trim();
    if (r && !related.includes(r)) onChange({ related: [...related, r] });
    setRelatedDraft("");
  };
  const removeRelated = (r: string) =>
    onChange({ related: related.filter((x) => x !== r) });

  // Categories grouped under their domain for the picker. Unknown-domain categories
  // are bucketed under "Other" so nothing disappears.
  const orderedDomains = [...domains].sort((a, b) => a.order - b.order);
  const known = new Set(domains.map((d) => d.id));
  const groups = orderedDomains
    .map((d) => ({ label: d.label, cats: categories.filter((c) => c.domain === d.id) }))
    .filter((g) => g.cats.length > 0);
  const orphans = categories.filter((c) => !known.has(c.domain));
  if (orphans.length) groups.push({ label: "Other", cats: orphans });

  const selectedCat = categories.find((c) => c.id === note.category);
  const selectedDomain = domains.find((d) => d.id === selectedCat?.domain);

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
          <span>Category{selectedDomain ? ` · ${selectedDomain.label}` : ""}</span>
          <div className="row catRow">
            <select value={note.category} onChange={(e) => onChange({ category: e.target.value })}>
              {!categories.some((c) => c.id === note.category) && (
                <option value={note.category}>{note.category}</option>
              )}
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="tiny" title="Add a category / domain" onClick={onAddCategory}>
              ＋
            </button>
          </div>
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

      <div className="field">
        <span>Related notes</span>
        <div className="chips">
          {related.map((r) => (
            <button
              key={r}
              className={idSet.has(r) ? "chip" : "chip bad"}
              onClick={() => removeRelated(r)}
              title={idSet.has(r) ? "Remove" : "Unknown note id — remove"}
            >
              {idSet.has(r) ? "" : "⚠ "}
              {r} ✕
            </button>
          ))}
        </div>
        <input
          list="all-note-ids"
          placeholder="Add related note id, Enter"
          value={relatedDraft}
          onChange={(e) => setRelatedDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRelated(relatedDraft);
            }
          }}
        />
        <datalist id="all-note-ids">
          {noteIds.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </div>

      <AssetManager savedId={savedId} assetVer={assetVer} />

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
