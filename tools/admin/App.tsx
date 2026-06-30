/**
 * Admin studio shell. Layout:
 *   sidebar (note list)  |  main: collapsible envelope bar  +  Source | Generated panes.
 *
 *   - Envelope bar (top): title + Save/Clone/Delete; expand to edit id/category/labels/related…
 *   - Source pane (left): paste raw notes → parse → insert anywhere into the body.
 *   - Generated pane (right): the live body — Preview | Edit | JSON tabs, all bound to draft.body.
 *
 * Saves validate against the same Zod schema as the build. Local-only; never deployed.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockNode, Category, Domain, Note, NoteMeta } from "../../src/lib/schema.ts";
import { CURRENT_SCHEMA_VERSION } from "../../src/lib/schema.ts";
import { dupeFlagsForNote, type DupeGroup } from "../../src/lib/dupes.ts";
import { api, ApiError } from "./api.ts";
import { EnvelopeForm, slugify } from "./EnvelopeForm.tsx";
import { SourcePane, type InsertTarget } from "./SourcePane.tsx";
import type { FindMatch } from "./find-utils.ts";
import { GeneratedPane } from "./GeneratedPane.tsx";
import { CatalogDialog } from "./CatalogDialog.tsx";
import { DupesDialog } from "./DupesDialog.tsx";
import { insertNodes } from "./tree-ops.ts";

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

/** Disclosure chevron — points down when open, right when closed (CSS-rotated). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chevron ${open ? "open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** MIME used when dragging a note in the sidebar to recategorize it. */
const NOTE_MIME = "application/x-note-id";

function useAdminTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("admin-theme") as "dark" | "light") ?? "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("admin-theme", theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

const makeBlank = (cats: Category[]): Note => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "",
  title: "",
  category: localStorage.getItem("admin:lastCategory") ?? cats[0]?.id ?? "",
  labels: [],
  summary: "",
  updated: new Date().toISOString().slice(0, 10),
  draft: false,
  body: [],
});

export function App() {
  const { theme, toggle: toggleTheme } = useAdminTheme();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [dupes, setDupes] = useState<DupeGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const [original, setOriginal] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [envOpen, setEnvOpen] = useState(false);
  // Bumped on "+ New note" so the keyed Source pane remounts even when selectedId stays null.
  const [sourceNonce, setSourceNonce] = useState(0);

  const persistCategoryNoteOrder = useCallback(async (cat: string, orderedIds: string[]) => {
    const updated = categories.map((c) =>
      c.id === cat ? { ...c, noteOrder: orderedIds } : c,
    );
    await api.saveCategories(updated, {});
    setCategories(updated);
  }, [categories]);

  // Source | Generated split: leftPct is the Source pane width.
  const [leftPct, setLeftPct] = useState(() => Number(localStorage.getItem("admin:leftPct")) || 46);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Block-tree undo/redo: snapshots of `body` only. Rapid changes (typing) within 400ms
  // coalesce into one step so undo jumps by edit, not by keystroke. forceHist re-renders
  // so the toolbar button disabled-state stays accurate.
  const undoRef = useRef<BlockNode[][]>([]);
  const redoRef = useRef<BlockNode[][]>([]);
  const lastPushRef = useRef(0);
  const [, forceHist] = useState(0);
  const resetHistory = () => {
    undoRef.current = [];
    redoRef.current = [];
    lastPushRef.current = 0;
    forceHist((n) => n + 1);
  };

  // Sidebar drag-to-recategorize: the category group currently hovered as a drop target.
  const [dropCat, setDropCat] = useState<string | null>(null);

  // Bumped whenever a note's colocated assets change (upload/delete), so the Assets panel
  // re-fetches without manual refresh.
  const [assetVer, setAssetVer] = useState(0);
  const bumpAssets = useCallback(() => setAssetVer((v) => v + 1), []);

  // Optional scroll sync between the Source textarea and the active Generated scroller.
  const [syncScroll, setSyncScroll] = useState(false);
  const srcScrollRef = useRef<HTMLTextAreaElement>(null);
  const genScrollRef = useRef<HTMLElement | null>(null);

  // Active find match from the Source pane — forwarded to GeneratedPane for right-pane scroll.
  const [findMatch, setFindMatch] = useState<FindMatch | null>(null);

  useEffect(() => {
    if (!syncScroll) return;
    let lock = false;
    const onScroll = (e: Event) => {
      if (lock) return;
      const src = srcScrollRef.current;
      const gen = genScrollRef.current;
      if (!src || !gen) return;
      const from = e.target as HTMLElement;
      const to = from === src ? gen : from === gen ? src : null;
      if (!to) return;
      lock = true;
      const max = from.scrollHeight - from.clientHeight;
      const ratio = max > 0 ? from.scrollTop / max : 0;
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => {
        lock = false;
      });
    };
    // Capture phase: scroll doesn't bubble, but capture sees inner elements — and reading
    // the refs live means a Generated tab switch needs no re-binding.
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [syncScroll]);

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
    setWarnings([]);
    api
      .note(selectedId)
      .then((n) => {
        setDraft(n);
        setOriginal(JSON.stringify(n));
        resetHistory();
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

  // Save is only allowed when the note has a title and a category (prevents accidental blank saves).
  const canSave = dirty && !!draft?.title.trim() && !!draft?.category.trim();

  const patch = (p: Partial<Note>) => {
    if (p.category) localStorage.setItem("admin:lastCategory", p.category);
    setDraft((d) => (d ? { ...d, ...p } : d));
  };
  const setBody = (body: BlockNode[]) =>
    setDraft((d) => {
      if (!d) return d;
      const now = Date.now();
      if (now - lastPushRef.current > 400) {
        undoRef.current.push(d.body);
        if (undoRef.current.length > 200) undoRef.current.shift();
      }
      lastPushRef.current = now;
      redoRef.current = [];
      forceHist((n) => n + 1);
      return { ...d, body };
    });

  const undo = useCallback(() => {
    if (undoRef.current.length === 0) return;
    setDraft((d) => {
      if (!d) return d;
      const prev = undoRef.current.pop()!;
      redoRef.current.push(d.body);
      return { ...d, body: prev };
    });
    lastPushRef.current = 0;
    forceHist((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    setDraft((d) => {
      if (!d) return d;
      const next = redoRef.current.pop()!;
      undoRef.current.push(d.body);
      return { ...d, body: next };
    });
    lastPushRef.current = 0;
    forceHist((n) => n + 1);
  }, []);

  const visibleNotes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      [n.title, n.category, ...n.labels].join(" ").toLowerCase().includes(q),
    );
  }, [notes, filter]);

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

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (mv: MouseEvent) => {
      if (!dragging.current || !panesRef.current) return;
      const rect = panesRef.current.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((mv.clientX - rect.left) / rect.width) * 100));
      setLeftPct(pct);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setLeftPct((pct) => { localStorage.setItem("admin:leftPct", String(pct)); return pct; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const selectNote = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return;
    setSelectedId(id);
    setSourceNonce((n) => n + 1);
  };

  const newNote = () => {
    if (!confirmDiscard()) return;
    setDraft(makeBlank(categories));
    setOriginal("");
    setSelectedId(null);
    setIssues([]);
    setWarnings([]);
    setStatus("");
    setEnvOpen(true);
    setSourceNonce((n) => n + 1);
    resetHistory();
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
    if (target.mode === "replace") return setBody(blocks);
    if (target.mode === "append") return setBody([...draft.body, ...blocks]);
    setBody(insertNodes(draft.body, target.path, target.mode, blocks));
  };

  // Non-blocking checks that an edit won't quietly break the site (dangling related ids, etc.).
  const preflight = (note: Note): string[] => {
    const w: string[] = [];
    const ids = new Set(notes.map((n) => n.id));
    ids.add(note.id);
    const dangling = (note.related ?? []).filter((r) => !ids.has(r));
    if (dangling.length) w.push(`Related points to unknown note(s): ${dangling.join(", ")}`);
    // Renaming this note can orphan other notes' related[] that still point at the old id.
    if (selectedId && note.id !== selectedId) {
      w.push(`Renamed id ${selectedId} → ${note.id}: check other notes' "related" don't reference the old id.`);
    }
    return w;
  };

  const save = async () => {
    if (!draft) return;
    setIssues([]);
    setStatus("Saving...");
    setWarnings(preflight(draft));
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

  const validate = async () => {
    setStatus("Validating…");
    setIssues([]);
    try {
      const { ok, output } = await api.validate();
      if (ok) {
        setStatus("✓ Content build passes — safe to deploy");
      } else {
        setStatus("✖ Content build failed — see details");
        setIssues(output.split("\n").filter((l) => l.trim()));
      }
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm(`Delete note "${selectedId}"? This removes its folder.`)) return;
    await api.remove(selectedId);
    setSelectedId(null);
    setDraft(makeBlank(categories));
    setOriginal("");
    resetHistory();
    await refreshLists();
  };

  // Sidebar drag-to-recategorize: assign a note to the dropped-on category (persisted).
  const recategorize = async (noteId: string, category: string) => {
    const meta = notes.find((n) => n.id === noteId);
    if (!meta || meta.category === category) return;
    if (noteId === selectedId && dirty) {
      setStatus("Save or discard the open note before moving it.");
      return;
    }
    try {
      const full = await api.note(noteId);
      await api.save(noteId, { ...full, category });
      await refreshLists();
      if (noteId === selectedId) {
        const reloaded = await api.note(noteId);
        setDraft(reloaded);
        setOriginal(JSON.stringify(reloaded));
      }
      setStatus(`Moved "${meta.title}" → ${category}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  // Keyboard: ⌘S save · ⌘Z undo · ⌘⇧Z / ⌘Y redo. In text inputs, defer undo/redo to the
  // browser's native text history; save still works everywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (dirty) save();
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const editable =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (editable) return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, undo, redo, draft, selectedId]);

  // Notes grouped by category for the sidebar (catalog order: domain, then category, then title).
  const noteGroups = useMemo(() => {
    const byCat = new Map<string, NoteMeta[]>();
    for (const n of visibleNotes) {
      const list = byCat.get(n.category) ?? byCat.set(n.category, []).get(n.category)!;
      list.push(n);
    }
    const catById = new Map(categories.map((c) => [c.id, c]));
    const domOrder = new Map(domains.map((d) => [d.id, d.order]));
    const order = (cat: string) => {
      const c = catById.get(cat);
      return [c ? domOrder.get(c.domain) ?? 999 : 999, c?.order ?? 999];
    };
    return [...byCat.keys()]
      .sort((a, b) => {
        const [da, oa] = order(a);
        const [db, ob] = order(b);
        return da - db || oa - ob || a.localeCompare(b);
      })
      .map((cat) => {
        const raw = byCat.get(cat)!;
        const noteOrder = catById.get(cat)?.noteOrder;
        const sorted = noteOrder
          ? [...raw].sort((a, b) => {
              const ia = noteOrder.indexOf(a.id);
              const ib = noteOrder.indexOf(b.id);
              return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            })
          : raw;
        return { cat, label: catById.get(cat)?.label ?? cat, notes: sorted };
      });
  }, [visibleNotes, categories, domains]);

  const dupeTitle =
    dupeFlags.size > 0
      ? [...dupeFlags.values()]
          .map(
            (g) =>
              `${g.kind}: also in ${g.occurrences
                .filter((o) => o.noteId !== draft?.id)
                .map((o) => o.noteId)
                .join(", ")}`,
          )
          .join("\n")
      : "";

  return (
    <div className="app">
      {/* Sidebar: note list */}
      <aside className="sidebar">
        <div className="brand">
          Notes Admin <span className="local">local-only</span>
          <button className="tiny themeToggle" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
        <button className="primary block" onClick={newNote}>+ New note</button>
        <button className="block" onClick={() => setCatalogOpen(true)}>Manage catalog…</button>
        <input
          className="filterBox"
          placeholder="Filter notes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="noteList">
          {noteGroups.map((g) => (
            <div className="noteGroup" key={g.cat}>
              <div
                className={`noteGroupHead${dropCat === g.cat ? " dropTarget" : ""}`}
                title="Drop a note here to move it to this category"
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(NOTE_MIME)) return;
                  e.preventDefault();
                  setDropCat(g.cat);
                }}
                onDragLeave={() => setDropCat((c) => (c === g.cat ? null : c))}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(NOTE_MIME);
                  setDropCat(null);
                  if (id) recategorize(id, g.cat);
                }}
              >
                {g.label}
              </div>
              <ul>
                {g.notes.map((n) => (
                  <li key={n.id}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(NOTE_MIME)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.currentTarget.classList.add("dropTarget");
                    }}
                    onDragLeave={(e) => e.currentTarget.classList.remove("dropTarget")}
                    onDrop={(e) => {
                      e.currentTarget.classList.remove("dropTarget");
                      e.stopPropagation();
                      const fromId = e.dataTransfer.getData(NOTE_MIME);
                      if (!fromId || fromId === n.id) return;
                      // Only reorder within the same category; cross-cat is handled by the header drop.
                      const ids = g.notes.map((x) => x.id);
                      if (!ids.includes(fromId)) return;
                      const next = ids.filter((id) => id !== fromId);
                      const toIdx = next.indexOf(n.id);
                      next.splice(toIdx, 0, fromId);
                      persistCategoryNoteOrder(g.cat, next);
                    }}
                  >
                    <button
                      className={n.id === selectedId ? "noteItem active" : "noteItem"}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(NOTE_MIME, n.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => selectNote(n.id)}
                    >
                      <span className="noteTitle">{n.title}</span>
                      {n.draft && <span className="noteMeta"><span className="draftTag">draft</span></span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {visibleNotes.length === 0 && <p className="noteMeta empty">No notes match "{filter}".</p>}
        </div>
        {dupes.length > 0 && (
          <button
            type="button"
            className="dupesSummary"
            title="View duplicate groups"
            onClick={() => setDupesOpen(true)}
          >
            ⚠ {dupes.length} duplicate group(s) across notes
          </button>
        )}
      </aside>

      {/* Main: envelope bar + Source | Generated panes */}
      <main className="workarea">
        <PreviewErrorBoundary>
          {draft ? (
            <>
              {/* Collapsible envelope bar */}
              <div className="envBar">
                <div className="toolbar">
                  <button
                    className="tiny iconBtn"
                    aria-label={envOpen ? "Collapse details" : "Expand details"}
                    title={envOpen ? "Collapse details" : "Expand details"}
                    onClick={() => setEnvOpen((v) => !v)}
                  >
                    <Chevron open={envOpen} />
                  </button>
                  <strong>{draft.title || (selectedId ? draft.id : "New note")}</strong>
                  <span className="schemaTag" title="Content schema version">v{draft.schemaVersion}</span>
                  {dirty && <span className="dirty">unsaved</span>}
                  {dupeFlags.size > 0 && (
                    <span className="dupeFlag" title={dupeTitle}>
                      ⚠ {dupeFlags.size} duplicated block{dupeFlags.size > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="spacer" />
                  <button
                    className="toggle tiny"
                    data-on={syncScroll}
                    title="Sync scroll between Source and Generated"
                    onClick={() => setSyncScroll((v) => !v)}
                  >
                    ⇅ scroll: {syncScroll ? "linked" : "free"}
                  </button>
                  {status && <span className="status inline">{status}</span>}
                  <button
                    className="tiny"
                    title="Undo block change (⌘Z)"
                    disabled={undoRef.current.length === 0}
                    onClick={undo}
                  >
                    ↶
                  </button>
                  <button
                    className="tiny"
                    title="Redo block change (⌘⇧Z)"
                    disabled={redoRef.current.length === 0}
                    onClick={redo}
                  >
                    ↷
                  </button>
                  <button onClick={validate} title="Run the strict content build (check-only) — confirms this will deploy">Validate</button>
                  {selectedId && <button onClick={cloneNote}>Clone</button>}
                  {selectedId && <button className="danger" onClick={remove}>Delete</button>}
                  <span
                    className="saveWrap"
                    data-tip={!draft?.title.trim() ? "Add a title before saving" : !draft?.category.trim() ? "Select a category before saving" : undefined}
                  >
                    <button className="primary" disabled={!canSave} onClick={save}>Save</button>
                  </span>
                </div>
                {draft.schemaVersion < CURRENT_SCHEMA_VERSION && (
                  <div className="versionWarn">
                    ⚠ This note is schema v{draft.schemaVersion}; current is v{CURRENT_SCHEMA_VERSION}.
                    Run <code>npm run migrate</code> to upgrade notes on disk before deploying.
                  </div>
                )}
                {issues.length > 0 && (
                  <ul className="issues">
                    {issues.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                )}
                {warnings.length > 0 && (
                  <ul className="issues warn">
                    {warnings.map((w) => <li key={w}>⚠ {w}</li>)}
                  </ul>
                )}
                {envOpen && (
                  <div className="envScroll">
                    <EnvelopeForm
                      note={draft}
                      onChange={patch}
                      categories={categories}
                      domains={domains}
                      allLabels={allLabels}
                      noteIds={notes.map((n) => n.id)}
                      onAddCategory={() => setCatalogOpen(true)}
                      savedId={selectedId}
                      assetVer={assetVer}
                    />
                  </div>
                )}
              </div>

              {/* Source | Generated */}
              <div className="importPanes" ref={panesRef}>
                <div className="paneWrap" style={{ width: `${leftPct}%` }}>
                  {/* Keyed by the open note so the paste box (and its live-ownership) resets when
                      you switch notes — a leftover paste can't bleed into another note. */}
                  <SourcePane
                    key={sourceNonce}
                    onResult={insertImported}
                    onTitle={(t) => { if (!draft?.title?.trim()) patch({ title: t, ...(!draft?.id?.trim() && { id: slugify(t) }) }); }}
                    textareaRef={srcScrollRef}
                    onFindMatch={setFindMatch}
                  />
                </div>
                <div className="paneDivider" onMouseDown={onDividerMouseDown} title="Drag to resize" />
                <div className="paneWrap" style={{ width: `${100 - leftPct}%` }}>
                  <GeneratedPane note={draft} onBody={setBody} dupeFlags={dupeFlags} scrollRef={genScrollRef} onAssetChange={bumpAssets} findMatch={findMatch} />
                </div>
              </div>
            </>
          ) : (
            <p style={{ padding: "1rem", opacity: 0.5 }}>Loading…</p>
          )}
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

      {dupesOpen && (
        <DupesDialog
          groups={dupes}
          onClose={() => setDupesOpen(false)}
          onSelect={selectNote}
        />
      )}
    </div>
  );
}
