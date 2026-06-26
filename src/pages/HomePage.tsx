import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useContent } from "../lib/useContent.ts";
import styles from "./pages.module.css";

export function HomePage() {
  const { index, categories, loading, error } = useContent();

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index) c.set(n.category, (c.get(n.category) ?? 0) + 1);
    return c;
  }, [index]);

  // Label cloud: every label with its note-count, most common first.
  const labels = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index) for (const l of n.labels) c.set(l, (c.get(l) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [index]);

  if (loading) return <div className={styles.dim}>Loading…</div>;
  if (error) return <div className={styles.dim}>{error}</div>;

  const visible = categories.filter((c) => counts.get(c.id));
  const maxCount = labels.length ? labels[0][1] : 1;

  return (
    <div>
      <h1 className={styles.hero}>Notes</h1>
      <p className={styles.heroSub}>
        {index.length} note{index.length === 1 ? "" : "s"} across {visible.length} topic
        {visible.length === 1 ? "" : "s"}.
      </p>
      <div className={styles.grid}>
        {visible.map((c) => (
          <Link key={c.id} to={`/${c.id}`} className={styles.card} style={{ ["--c" as string]: c.color }}>
            <span className={styles.cardDot} />
            <span className={styles.cardTitle}>{c.label}</span>
            <span className={styles.cardCount}>{counts.get(c.id)}</span>
          </Link>
        ))}
      </div>

      {labels.length > 0 && (
        <section className={styles.cloudSection}>
          <h2 className={styles.sectionTitle}>Labels</h2>
          <div className={styles.cloud}>
            {labels.map(([label, count]) => (
              <Link
                key={label}
                to={`/label/${encodeURIComponent(label)}`}
                className={styles.cloudChip}
                style={{ ["--w" as string]: 0.5 + (count / maxCount) * 0.5 }}
              >
                {label}
                <span className={styles.cloudCount}>{count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
