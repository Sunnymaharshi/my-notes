import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Note } from "../../lib/schema.ts";
import { collectBranchPaths } from "../../lib/tree.ts";
import { ancestorPaths } from "../../lib/search.ts";
import { BlockRenderer } from "../blocks/BlockRenderer.tsx";
import { TreeContext } from "../blocks/context.ts";
import note from "../NoteView.module.css";
import styles from "./views.module.css";

/** Default view: the collapsible outline, with expand/collapse/revision controls. */
export function TreeView({ note: noteData, showControls = true }: { note: Note; showControls?: boolean }) {
  const branches = useMemo(() => collectBranchPaths(noteData.body), [noteData]);
  // `collapsed` holds the paths that are closed; everything else is open.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(
    () => ({
      isOpen: (path: string) => !collapsed.has(path),
      toggle: (path: string) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.has(path) ? next.delete(path) : next.add(path);
          return next;
        }),
    }),
    [collapsed],
  );

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(branches.map((b) => b.path)));
  // Revision: keep only top-level sections open, collapse everything deeper.
  const revision = () =>
    setCollapsed(new Set(branches.filter((b) => b.depth >= 1).map((b) => b.path)));

  // Deep-link target (e.g. #n3.2 from a search hit): force its ancestor branches
  // open, then scroll to and briefly flash the node once it's mounted + expanded.
  const { hash } = useLocation();
  useEffect(() => {
    const anchor = decodeURIComponent(hash.replace(/^#/, ""));
    if (!anchor.startsWith("n")) return;
    const path = anchor.slice(1);
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const a of ancestorPaths(path)) next.delete(a);
      return next;
    });
    let tries = 0;
    let timer = window.setTimeout(function find() {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(note.flash);
        window.setTimeout(() => el.classList.remove(note.flash), 1600);
      } else if (tries++ < 12) {
        timer = window.setTimeout(find, 60);
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [hash, noteData]);

  return (
    <>
      {showControls && (
        <div className={note.controls}>
          <button onClick={expandAll}>Expand all</button>
          <button onClick={collapseAll}>Collapse all</button>
          <button onClick={revision} className={note.revision}>
            Revision mode
          </button>
        </div>
      )}

      <TreeContext.Provider value={tree}>
        <div className={styles.tree}>
          {noteData.body.map((node, i) => (
            <BlockRenderer key={i} node={node} path={String(i)} />
          ))}
        </div>
      </TreeContext.Provider>
    </>
  );
}
