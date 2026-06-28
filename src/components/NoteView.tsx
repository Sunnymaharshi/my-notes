import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Note } from "../lib/schema.ts";
import { useIsBookmarked, toggleBookmark } from "../lib/bookmarks.ts";
import { useContent } from "../lib/useContent.ts";
import { NoteContext } from "./blocks/context.ts";
import { TreeView } from "./views/TreeView.tsx";
import { DocView } from "./views/DocView.tsx";
import { FlashcardView } from "./views/FlashcardView.tsx";
import { TopicView } from "./views/TopicView.tsx";
import { OutlineSpine } from "./OutlineSpine.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import styles from "./NoteView.module.css";
import views from "./views/views.module.css";

type View = "tree" | "doc" | "cards";
const VIEWS: { id: View; label: string }[] = [
  { id: "tree", label: "Outline" },
  { id: "doc", label: "Document" },
  { id: "cards", label: "Flashcards" },
];

export function NoteView({ note }: { note: Note }) {
  const [view, setView] = useState<View>("tree");
  const bookmarked = useIsBookmarked(note.id);
  const { hash } = useLocation();
  const { index, categories } = useContent();

  // Resolve related note ids to their metadata (skip ids that don't resolve / are drafts).
  const related = useMemo(() => {
    if (!note.related?.length) return [];
    const byId = new Map(index.map((n) => [n.id, n]));
    return note.related.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [note.related, index]);

  // Prev/next note within the same category (same title sort as the sidebar),
  // so a note reads as a guided path rather than a dead end.
  const { prevNote, nextNote } = useMemo(() => {
    const noteOrder = categories.find((c) => c.id === note.category)?.noteOrder;
    const siblings = index
      .filter((n) => n.category === note.category)
      .sort((a, b) => {
        if (noteOrder) {
          const ia = noteOrder.indexOf(a.id);
          const ib = noteOrder.indexOf(b.id);
          if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
        }
        return a.title.localeCompare(b.title);
      });
    const i = siblings.findIndex((n) => n.id === note.id);
    return {
      prevNote: i > 0 ? siblings[i - 1] : null,
      nextNote: i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : null,
    };
  }, [index, categories, note.category, note.id]);

  // Reset to the default view when navigating between notes.
  useEffect(() => setView("tree"), [note.id]);

  // Deep-link from a search hit (e.g. #n3.2) → focused subtopic view.
  const subtopicPath = (() => {
    const anchor = decodeURIComponent(hash.replace(/^#/, ""));
    return anchor.startsWith("n") ? anchor.slice(1) : null;
  })();

  const showSpine = !subtopicPath && view !== "cards";

  return (
    <NoteContext.Provider value={{ noteId: note.id }}>
      <div className={`${styles.layout} ${showSpine ? "" : styles.noSpine}`}>
      <article className={styles.note}>
        <header className={`${styles.header} ${hash ? styles.headerCompact : ""}`}>
          <div className={styles.crumbs}>
            <Link to="/" className={styles.crumb}>
              Home
            </Link>
            <span className={styles.sep}>/</span>
            <Link to={`/${note.category}`} className={styles.crumb}>
              {note.category}
            </Link>
          </div>
          <h1 className={styles.title}>
            {note.title}
            {note.draft && <span className={styles.draft}>DRAFT</span>}
            <Tooltip label={bookmarked ? "Remove bookmark" : "Bookmark this note"} side="left">
              <button
                className={styles.star}
                data-on={bookmarked}
                onClick={() => toggleBookmark(note.id)}
                aria-pressed={bookmarked}
              >
                {bookmarked ? "★" : "☆"}
              </button>
            </Tooltip>
          </h1>
          {!hash && (
            <>
              {note.summary && <p className={styles.summary}>{note.summary}</p>}
              <div className={styles.meta}>
                {note.difficulty && (
                  <span className={`${styles.diff} ${styles[`diff_${note.difficulty}`] ?? ""}`}>
                    {note.difficulty}
                  </span>
                )}
                {note.labels.map((l) => (
                  <Link key={l} to={`/label/${encodeURIComponent(l)}`} className={styles.label}>
                    {l}
                  </Link>
                ))}
                {note.updated && <span className={styles.updated}>Updated {note.updated}</span>}
              </div>
            </>
          )}
        </header>

        {!subtopicPath && (
          <div className={views.switcher}>
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={`${views.tab} ${view === v.id ? views.tabActive : ""}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        <div className={styles.body}>
          {subtopicPath ? (
            <TopicView note={note} path={subtopicPath} />
          ) : (
            <>
              {view === "tree" && <TreeView note={note} />}
              {view === "doc" && <DocView note={note} />}
              {view === "cards" && <FlashcardView note={note} />}
            </>
          )}
        </div>

        {!subtopicPath && related.length > 0 && (
          <section className={styles.related}>
            <h2 className={styles.relatedTitle}>Related</h2>
            <div className={styles.relatedList}>
              {related.map((r) => (
                <Link key={r.id} to={`/${r.category}/${r.id}`} className={styles.relatedCard}>
                  <span className={styles.relatedCardTitle}>{r.title}</span>
                  {r.summary && <span className={styles.relatedCardSummary}>{r.summary}</span>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {!subtopicPath && (prevNote || nextNote) && (
          <nav className={styles.pager} aria-label="Notes in this category">
            {prevNote ? (
              <Link to={`/${prevNote.category}/${prevNote.id}`} className={styles.pagerLink}>
                <span className={styles.pagerDir}>← Previous</span>
                <span className={styles.pagerTitle}>{prevNote.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {nextNote ? (
              <Link
                to={`/${nextNote.category}/${nextNote.id}`}
                className={`${styles.pagerLink} ${styles.pagerNext}`}
              >
                <span className={styles.pagerDir}>Next →</span>
                <span className={styles.pagerTitle}>{nextNote.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </article>
        {showSpine && (
          <aside className={styles.spineCol}>
            <OutlineSpine note={note} view={view} />
          </aside>
        )}
      </div>
    </NoteContext.Provider>
  );
}
