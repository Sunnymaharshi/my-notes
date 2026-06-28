import { useParams, Link } from "react-router-dom";
import { useContent, categoryLabel } from "../lib/useContent.ts";
import styles from "./pages.module.css";

export function CategoryPage() {
  const { category = "" } = useParams();
  const { index, categories, loading } = useContent();

  if (loading) return <div className={styles.dim}>Loading…</div>;

  const noteOrder = categories.find((c) => c.id === category)?.noteOrder;
  const notes = index
    .filter((n) => n.category === category)
    .sort((a, b) => {
      if (noteOrder) {
        const ia = noteOrder.indexOf(a.id);
        const ib = noteOrder.indexOf(b.id);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      }
      return a.title.localeCompare(b.title);
    });

  return (
    <div className={styles.list}>
      <h1 className={styles.pageTitle}>{categoryLabel(categories, category)}</h1>
      {notes.length === 0 && <div className={styles.dim}>No notes yet.</div>}
      {notes.map((n) => (
        <Link key={n.id} to={`/${n.category}/${n.id}`} className={styles.row}>
          <div className={styles.rowTitle}>
            {n.title}
            {n.draft && <span className={styles.draftTag}>draft</span>}
          </div>
          {n.summary && <div className={styles.rowSummary}>{n.summary}</div>}
          {n.labels.length > 0 && (
            <div className={styles.rowLabels}>
              {n.labels.map((l) => (
                <span key={l} className={styles.miniLabel}>
                  {l}
                </span>
              ))}
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
