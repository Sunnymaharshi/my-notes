/**
 * Admin studio shell. Layout: sidebar (note list) | main content area.
 * Main area: paste notes (top, always visible) + envelope form (bottom).
 * Saves validate against the same Zod schema as the build.
 * Local-only; never deployed.
 */
import { Component, useEffect, useMemo, useState } from "react";
import type { BlockNode, Category, Domain, Note, NoteMeta } from "../../src/lib/schema.ts";
import { CURRENT_SCHEMA_VERSION } from "../../src/lib/schema.ts";
import { dupeFlagsForNote, type DupeGroup } from "../../src/lib/dupes.ts";
import { api, ApiError } from "./api.ts";
import { EnvelopeForm } from "./EnvelopeForm.tsx";
import { ImportDialog, type InsertTarget } from "./ImportDialog.tsx";
import { CatalogDialog } from "./CatalogDialog.tsx";
import { appendChild } from "./tree-ops.ts";

class PreviewErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error)
      return (
        <div style={{ padding: "1rem", color: "var(--c-danger, red)", fontFamily: "monospace", fontSize: "0.8rem" }}>
          Preview error: {this.state.error}
        </div>
      );
    return this.props.children;
  }
}

const makeBlank = (cats: Category[]): Note => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "",
  title: "",
  category: cats[0]?.id ?? "",
  labels: [],
  summary: "",
  updated: new Date().toISOString().slice(0, 10),
  draft: true,
  body: [],
});

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
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [filter, setFilter] = useState("");

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

  // Initialize to a blank draft once categories are loaded.
  useEffect(() => {
    if (categories.length > 0 && draft === null && selectedId === null) {
      setDraft(makeBlank(categories));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  const allLabels = useMemo(
    () => [...new Set(notes.flatMap((n) => n.labels))].sort(),
    [notes],
  );
  const dupeFlags = useMemo(
    () => (draft ? dupeFlagsForNote(draft.id, dupes) : new Map<string, DupeGroup>()),
    [draft, dupes],
  );

  // New (unsaved) notes are "dirty" as soon as they have a title or body; saved notes use JSON diff.
  const dirty =
    draft != null &&
    (selectedId === null
      ? draft.title.trim() !== "" || draft.body.length > 0
      : JSON.stringify(draft) !== original);

  const patch = (p: Partial<Note>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const visibleNotes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      [n.title, n.category, ...n.labels].join(" ").toLowerCase().includes(q),
    );
  }, [notes, filter]);

  const sections = useMemo(
    () =>
      (draft?.body ?? [])
        .map((node, i) => ({ node, path: String(i) }))
        .filter((s) => s.node.type === "outline")
        .map((s) => ({ path: s.path, label: (s.node as { text: string }).text })),
    [draft],
  );

  const confirmDiscard = () =>
    !dirty || window.confirm("Discard unsaved changes to this note?");

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

  const newNote = () => {
    if (!confirmDiscard()) return;
    setDraft(makeBlank(categories));
    setOriginal("");
    setSelectedId(null);
    setIssues([]);
    setStatus("");
  };

  const cloneNote = async () => {
    if (!draft || !confirmDiscard()) return;
    const title = window.prompt("Title for the cloned note?", `${draft.title} (copy)`);
    if (!title) return;
    setStatus("Cloning...");
    try {
      const skeleton = await api.create({ title, category: draft.category });
      const saved = await api.save(skeleton.id, { ...draft, id: skeleton.id, title, draft: true });
      await refreshLists();
      setSelectedId(saved.id);
      setStatus(`Cloned to ${saved.id}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

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
    if (!draft) return;
    setIssues([]);
    setStatus("Saving...");
    try {
      let id = selectedId;
      if (!id) {
        const created = await api.create({
          id: draft.id.trim() || undefined,
          title: draft.title.trim() || "Untitled",
          category: draft.category || (categories[0]?.id ?? "uncategorized"),
        });
        id = created.id;
      }
      const saved = await api.save(id, { ...draft, id: draft.id.trim() || id });
      setDraft(saved);
      setOriginal(JSON.stringify(saved));
      setSelectedId(saved.id);
      setStatus(`Saved ${saved.id}`);
      await refreshLists();
    } catch (e) {
      if (e instanceof ApiError && e.issues) {
        setIssues(e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
        setStatus("Validation failed -- fix the fields below.");
      } else {
        setStatus((e as Error).message);
      }
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm(`Delete note "${selectedId}"? This removes its folder.`)) return;
    await api.remove(selectedId);
    setSelectedId(null);
    setDraft(makeBlank(categories));
    setOriginal("");
    await refreshLists();
  };

  return (
    <div className="app">
      {/* Sidebar: note list */}
      <aside className="sidebar">
        <div className="brand">
          Notes Admin <span className="local">local-only</span>
        </div>
        <button className="primary block" onClick={newNote}>+ New note</button>
        <button className="block" onClick={() => setCatalogOpen(true)}>Manage catalog...</button>
        <input
          className="filterBox"
          placeholder="Filter notes..."
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
          {visibleNotes.length === 0 && <li className="noteMeta">No notes match "{filter}".</li>}
        </ul>
        {dupes.length > 0 && (
          <div className="dupesSummary">⚠ {dupes.length} duplicate group(s) across notes</div>
        )}
      </aside>

      {/* Main content: paste panes (top) + envelope form (bottom).
          Guarded so a render crash in either pane shows a message, not a blank screen. */}
      <main className="workarea">
       <PreviewErrorBoundary>
        {/* Top: always-visible paste notes area */}
        <section className="pasteSection">
          <ImportDialog
            embedded
            sections={sections}
            onClose={() => {}}
            onResult={insertImported}
          />
        </section>

        {/* Bottom: note metadata form + toolbar */}
        <section className="formSection">
          {draft ? (
            <>
              <div className="toolbar">
                <strong>{draft.title || (selectedId ? draft.id : "New note")}</strong>
                {dirty && <span className="dirty">unsaved</span>}
                {dupeFlags.size > 0 && (
                  <span
                    className="dupeFlag"
                    title={[...dupeFlags.values()]
                      .map(
                        (g) =>
                          `${g.kind}: also in ${g.occurrences
                            .filter((o) => o.noteId !== draft.id)
                            .map((o) => o.noteId)
                            .join(", ")}`,
                      )
                      .join("\n")}
                  >
                    ⚠ {dupeFlags.size} duplicated block{dupeFlags.size > 1 ? "s" : ""}
                  </span>
                )}
                <span className="spacer" />
                {selectedId && <button onClick={cloneNote}>Clone</button>}
                {selectedId && <button className="danger" onClick={remove}>Delete</button>}
                <button className="primary" disabled={!dirty} onClick={save}>Save</button>
              </div>
              {status && <div className="status">{status}</div>}
              {issues.length > 0 && (
                <ul className="issues">
                  {issues.map((i) => <li key={i}>{i}</li>)}
                </ul>
              )}
              <div className="formScroll">
                <EnvelopeForm
                  note={draft}
                  onChange={patch}
                  categories={categories}
                  domains={domains}
                  allLabels={allLabels}
                />
              </div>
            </>
          ) : (
            <p style={{ padding: "1rem", opacity: 0.5 }}>Loading...</p>
          )}
        </section>
       </PreviewErrorBoundary>
      </main>

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
