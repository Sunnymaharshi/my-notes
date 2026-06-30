import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useContent } from "../lib/useContent.ts";
import { useLayoutContext } from "../components/Layout.tsx";
import { colorFromId } from "../lib/color.ts";
import styles from "./pages.module.css";

export function HomePage() {
  const { index, categories, domains, loading, error } = useContent();
  const { openPalette } = useLayoutContext();

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index) c.set(n.category, (c.get(n.category) ?? 0) + 1);
    return c;
  }, [index]);

  // Categories that actually have notes, grouped under their domain (domain order,
  // then category order). Categories whose domain is unknown fall into "Other".
  const domainGroups = useMemo(() => {
    const visible = categories.filter((c) => counts.get(c.id));
    const known = new Set(domains.map((d) => d.id));
    const ordered = [...domains].sort((a, b) => a.order - b.order);
    const groups = ordered
      .map((d) => ({
        id: d.id,
        label: d.label,
        cats: visible.filter((c) => c.domain === d.id).sort((a, b) => a.order - b.order),
      }))
      .filter((g) => g.cats.length > 0);
    const orphans = visible.filter((c) => !known.has(c.domain));
    if (orphans.length) groups.push({ id: "other", label: "Other", cats: orphans });
    return groups;
  }, [categories, domains, counts]);

  // Label cloud: every label with its note-count, most common first.
  const labels = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index) for (const l of n.labels) c.set(l, (c.get(l) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [index]);

  if (loading) return <div className={styles.dim}>Loading…</div>;
  if (error) return <div className={styles.dim}>{error}</div>;

  const catCount = domainGroups.reduce((sum, g) => sum + g.cats.length, 0);
  const maxCount = labels.length ? labels[0][1] : 1;

  return (
    <div>
      <header className={styles.heroBlock}>
        <p className={styles.heroSub}>
          <strong>{index.length}</strong> note{index.length === 1 ? "" : "s"} ·{" "}
          <strong>{catCount}</strong> categor{catCount === 1 ? "y" : "ies"} ·{" "}
          <strong>{labels.length}</strong> label{labels.length === 1 ? "" : "s"}
        </p>
        <span className={styles.heroEyebrow}>Field manual</span>
        <h1 className={styles.hero}>
          A working memory for the things worth keeping close.
        </h1>
        <button className={styles.heroSearch} onClick={openPalette} aria-label="Open search">
          <span className={styles.heroSearchIcon}>⌕</span>
          <span className={styles.heroSearchPlaceholder}>Search notes…</span>
          <kbd className={styles.heroSearchKbd}>⌘K</kbd>
        </button>
      </header>

      {domainGroups.map((g) => (
        <section key={g.id} className={styles.domainSection}>
          <h2 className={styles.domainTitle}>{g.label}</h2>
          <div className={styles.grid}>
            {g.cats.map((c) => (
              <Link
                key={c.id}
                to={`/${c.id}`}
                className={styles.card}
                style={{ ["--c" as string]: c.color || colorFromId(c.id) }}
              >
                <span className={styles.cardDot} />
                <span className={styles.cardTitle}>{c.label}</span>
                <span className={styles.cardCount}>{counts.get(c.id)}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

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
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
