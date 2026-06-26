import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Note } from "../lib/schema.ts";
import { useIsBookmarked, toggleBookmark } from "../lib/bookmarks.ts";
import { NoteContext } from "./blocks/context.ts";
import { TreeView } from "./views/TreeView.tsx";
import { DocView } from "./views/DocView.tsx";
import { FlashcardView } from "./views/FlashcardView.tsx";
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

  // Reset to the default view when navigating between notes.
  useEffect(() => setView("tree"), [note.id]);

  return (
    <NoteContext.Provider value={{ noteId: note.id }}>
      <article className={styles.note}>
        <header className={styles.header}>
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
            <button
              className={styles.star}
              data-on={bookmarked}
              onClick={() => toggleBookmark(note.id)}
              title={bookmarked ? "Remove bookmark" : "Bookmark this note"}
              aria-pressed={bookmarked}
            >
              {bookmarked ? "★" : "☆"}
            </button>
          </h1>
          {note.summary && <p className={styles.summary}>{note.summary}</p>}
          <div className={styles.meta}>
            {note.difficulty && <span className={styles.diff}>{note.difficulty}</span>}
            {note.labels.map((l) => (
              <Link key={l} to={`/label/${encodeURIComponent(l)}`} className={styles.label}>
                {l}
              </Link>
            ))}
          </div>
        </header>

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

        <div className={styles.body}>
          {view === "tree" && <TreeView note={note} />}
          {view === "doc" && <DocView note={note} />}
          {view === "cards" && <FlashcardView note={note} />}
        </div>
      </article>
    </NoteContext.Provider>
  );
}
