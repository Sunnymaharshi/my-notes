/**
 * Duplicate-content viewer (local admin): lists every duplicate group found across (and within)
 * notes by `src/lib/dupes.ts` — the detail behind the sidebar's "N duplicate group(s)" summary.
 * Read-only; some repeats are legitimate (the same decorator named in two sections), so this is
 * a review aid, not a forced cleanup. Clicking an occurrence opens that note in the editor.
 */
import type { DupeGroup } from "../../src/lib/dupes.ts";

export function DupesDialog({
  groups,
  onClose,
  onSelect,
}: {
  groups: DupeGroup[];
  onClose: () => void;
  /** Open a note in the editor (and close the dialog). */
  onSelect: (noteId: string) => void;
}) {
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal dupesModal" onClick={(e) => e.stopPropagation()}>
        <h2>
          Duplicate content{" "}
          <span className="dupesCount">
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </span>
        </h2>

        {groups.length === 0 ? (
          <p className="hint">No duplicate text or code blocks across notes.</p>
        ) : (
          <div className="dupesList">
            {groups.map((g, i) => (
              <div className="dupeGroup" key={i}>
                <div className="dupeGroupHead">
                  <span className={`dupeKind ${g.kind}`}>{g.kind}</span>
                  <span className="dupeTimes">×{g.occurrences.length}</span>
                  <code className="dupeSample">{sample(g.occurrences[0].raw)}</code>
                </div>
                <ul className="dupeOccs">
                  {g.occurrences.map((o, j) => (
                    <li key={j}>
                      <button
                        className="dupeOccBtn"
                        title={`Open ${o.noteId}`}
                        onClick={() => {
                          onSelect(o.noteId);
                          onClose();
                        }}
                      >
                        <span className="dupeNoteId">{o.noteId}</span>
                        <span className="dupePath">#{o.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="hint">
          Exact text/code matches across and within notes. Repeats are sometimes intentional —
          this is a review aid, not a required cleanup. Click an occurrence to open that note.
        </p>

        <div className="modalActions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** One-line preview of an occurrence's raw text/code. */
function sample(raw: string): string {
  const first = raw.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}
