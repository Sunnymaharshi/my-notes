/**
 * Admin studio shell (PLAN §7). Three panes: note list, editor (envelope + blocks), and a
 * live preview using the real site renderer. Saves validate against the same Zod schema as
 * the build before writing content/notes/<id>/index.json. Local-only; never deployed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockNode, Category, Domain, Note, NoteMeta } from "../../src/lib/schema.ts";
import { dupeFlagsForNote, type DupeGroup } from "../../src/lib/dupes.ts";
import { api, ApiError } from "./api.ts";
import { EnvelopeForm } from "./EnvelopeForm.tsx";
import { BlockEditor } from "./BlockEditor.tsx";
import { Preview } from "./Preview.tsx";
import { ImportDialog, type InsertTarget } from "./ImportDialog.tsx";
import { CatalogDialog } from "./CatalogDialog.tsx";
import { appendChild } from "./tree-ops.ts";

export function App() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [dupes, setDupes] = useState<DupeGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [original, setOriginal] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [syncScroll, setSyncScroll] = useState(false);
  const [filter, setFilter] = useState("");

  const editScrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);

  // Linked scrolling: mirror one pane's scroll position onto the other, proportionally.
  // A guard flag prevents the programmatic scroll from echoing back into a loop.
  useEffect(() => {
    if (!syncScroll) return;
    const a = editScrollRef.current;
    const b = previewRef.current;
    if (!a || !b) return;
    let locked = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => {
      if (locked) return;
      locked = true;
      const max = from.scrollHeight - from.clientHeight;
      const ratio = max > 0 ? from.scrollTop / max : 0;
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => (locked = false));
    };
    const onA = () => mirror(a, b);
    const onB = () => mirror(b, a);
    a.addEventListener("scroll", onA);
    b.addEventListener("scroll", onB);
    return () => {
      a.removeEventListener("scroll", onA);
      b.removeEventListener("scroll", onB);
    };
  }, [syncScroll, draft]);

  const refreshLists = async () => {
    const [n, d] = await Promise.all([api.notes(), api.dupes()]);
    setNotes(n);
    setDupes(d);
  };

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
    api.domains().then(setDomains).catch(() => {});
    refreshLists().catch((e) => setStatus(String(e)));
  }, []);

  // Load a note into the editor when selection changes.
  useEffect(() => {
    if (!selectedId) return;
    setIssues([]);
    api
      .note(selectedId)
      .then((n) => {
        setDraft(n);
        setOriginal(JSON.stringify(n));
      })
      .catch((e) => setStatus(String(e)));
  }, [selectedId]);

  const allLabels = useMemo(
    () => [...new Set(notes.flatMap((n) => n.labels))].sort(),
    [notes],
  );
  const dupeFlags = useMemo(
    () => (draft ? dupeFlagsForNote(draft.id, dupes) : new Map()),
    [draft, dupes],
  );
  const dirty = draft != null && JSON.stringify(draft) !== original;

  const patch = (p: Partial<Note>) => setDraft((d) => (d ? { ...d, ...p } : d));

  // Filtered note list for the sidebar (matches title / category / labels, case-insensitive).
  const visibleNotes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      [n.title, n.category, ...n.labels].join(" ").toLowerCase().includes(q),
    );
  }, [notes, filter]);

  // Top-level sections of the current note — targets for "insert under…" on import.
  const sections = useMemo(
    () =>
      (draft?.body ?? [])
        .map((node, i) => ({ node, path: String(i) }))
        .filter((s) => s.node.type === "outline")
        .map((s) => ({ path: s.path, label: (s.node as { text: string }).text })),
    [draft],
  );

  // Unsaved-changes guard: confirm before any action that would discard the current edits.
  const confirmDiscard = () =>
    !dirty || window.confirm("Discard unsaved changes to this note?");

  // Warn on a hard browser close/reload while there are unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const selectNote = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return;
    setSelectedId(id);
  };

  const createNote = async () => {
    if (!confirmDiscard()) return;
    const title = window.prompt("New note title?");
    if (!title) return;
    try {
      const note = await api.create({ title, category: categories[0]?.id ?? "uncategorized" });
      await refreshLists();
      setSelectedId(note.id);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  // Clone: duplicate the loaded note's whole body under a fresh id, as a new draft.
  const cloneNote = async () => {
    if (!draft || !confirmDiscard()) return;
    const title = window.prompt("Title for the cloned note?", `${draft.title} (copy)`);
    if (!title) return;
    setStatus("Cloning…");
    try {
      const skeleton = await api.create({ title, category: draft.category });
      const saved = await api.save(skeleton.id, {
        ...draft,
        id: skeleton.id,
        title,
        draft: true,
      });
      await refreshLists();
      setSelectedId(saved.id);
      setStatus(`Cloned to ${saved.id}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  // Place imported blocks per the chosen target: append, replace, or nest under a section.
  const insertImported = (blocks: BlockNode[], target: InsertTarget) => {
    if (!draft) return;
    if (target.mode === "replace") return patch({ body: blocks });
    if (target.mode === "section") {
      let body = draft.body;
      for (const b of blocks) body = appendChild(body, target.path, b);
      return patch({ body });
    }
    patch({ body: [...draft.body, ...blocks] });
  };

  const save = async () => {
    if (!draft || !selectedId) return;
    setIssues([]);
    setStatus("Saving…");
    try {
      const saved = await api.save(selectedId, draft);
      setDraft(saved);
      setOriginal(JSON.stringify(saved));
      setStatus(`Saved ${saved.id}`);
      await refreshLists();
      if (saved.id !== selectedId) setSelectedId(saved.id); // followed a rename
    } catch (e) {
      if (e instanceof ApiError && e.issues) {
        setIssues(e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
        setStatus("Validation failed — fix the fields below.");
      } else {
        setStatus((e as Error).message);
      }
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm(`Delete note "${selectedId}"? This removes its folder.`)) return;
    await api.remove(selectedId);
    setSelectedId(null);
    setDraft(null);
    await refreshLists();
  };

  const dockOpen = importOpen && Boolean(draft);

  return (
    <div className={`app ${dockOpen ? "withDock" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          Notes Admin <span className="local">local-only</span>
        </div>
        <button className="primary block" onClick={createNote}>+ New note</button>
        <button className="block" onClick={() => setCatalogOpen(true)}>Manage catalog…</button>
        <input
          className="filterBox"
          placeholder="Filter notes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="noteList">
          {visibleNotes.map((n) => (
            <li key={n.id}>
              <button
                className={n.id === selectedId ? "noteItem active" : "noteItem"}
                onClick={() => selectNote(n.id)}
              >
                <span className="noteTitle">{n.title}</span>
                <span className="noteMeta">
                  {n.category}
                  {n.draft && <span className="draftTag">draft</span>}
                </span>
              </button>
            </li>
          ))}
          {visibleNotes.length === 0 && <li className="noteMeta">No notes match “{filter}”.</li>}
        </ul>
        {dupes.length > 0 && (
          <div className="dupesSummary">⚠ {dupes.length} duplicate group(s) across notes</div>
        )}
      </aside>

      {dockOpen && (
        <ImportDialog
          docked
          sections={sections}
          onClose={() => setImportOpen(false)}
          onResult={insertImported}
        />
      )}

      {draft ? (
        <main className="editor">
          <div className="toolbar">
            <strong>{draft.title || draft.id}</strong>
            {dirty && <span className="dirty">● unsaved</span>}
            <span className="spacer" />
            <button
              className="toggle"
              data-on={syncScroll}
              title="Link editor & preview scrolling"
              onClick={() => setSyncScroll((v) => !v)}
            >
              ⇅ scroll: {syncScroll ? "linked" : "free"}
            </button>
            <button className="toggle" data-on={importOpen} onClick={() => setImportOpen((v) => !v)}>
              Paste{importOpen ? " ✓" : "…"}
            </button>
            <button onClick={cloneNote}>Clone</button>
            <button className="danger" onClick={remove}>Delete</button>
            <button className="primary" disabled={!dirty} onClick={save}>Save</button>
          </div>

          {status && <div className="status">{status}</div>}
          {issues.length > 0 && (
            <ul className="issues">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}

          <div className="editScroll" ref={editScrollRef}>
            <EnvelopeForm
              note={draft}
              onChange={patch}
              categories={categories}
              domains={domains}
              allLabels={allLabels}
            />
            <h3 className="sectionHead">Blocks</h3>
            <BlockEditor
              body={draft.body}
              onChange={(body) => patch({ body })}
              dupeFlags={dupeFlags}
              noteId={draft.id}
            />
          </div>
        </main>
      ) : (
        <main className="editor empty">
          <p>Select a note, or create one.</p>
        </main>
      )}

      <aside className="preview" ref={previewRef}>
        {draft && <Preview note={draft} />}
      </aside>

      {catalogOpen && (
        <CatalogDialog
          categories={categories}
          domains={domains}
          onClose={() => setCatalogOpen(false)}
          onSaved={(c, d) => {
            setCategories(c);
            setDomains(d);
          }}
        />
      )}
    </div>
  );
}
