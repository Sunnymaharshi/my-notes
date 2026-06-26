import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useContent } from "../lib/useContent.ts";
import { runSearch, noteLink, type SearchHit } from "../lib/search.ts";
import type { NoteMeta } from "../lib/schema.ts";
import styles from "./pages.module.css";

/**
 * Faceted label browsing (PLAN §4/§8). The route label is the base facet; clicking a
 * co-occurring label ANDs it in to narrow the set. An optional text query runs the
 * MiniSearch index filtered to the active labels — text + label facets, combined.
 */
export function LabelPage() {
  const { label = "" } = useParams();
  const { index, loading } = useContent();

  // Extra labels AND-ed onto the base label. Reset when the route label changes.
  const [extra, setExtra] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    setExtra([]);
    setQuery("");
  }, [label]);

  const active = useMemo(() => [label, ...extra], [label, extra]);

  // Notes carrying every active label (the facet result before any text query).
  const matched = useMemo(
    () =>
      index
        .filter((n) => active.every((l) => n.labels.includes(l)))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [index, active],
  );

  // Co-occurring labels on the matched notes, by frequency (the facet suggestions).
  const cooccurring = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of matched) {
      for (const l of n.labels) {
        if (!active.includes(l)) c.set(l, (c.get(l) ?? 0) + 1);
      }
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [matched, active]);

  // Text query → MiniSearch filtered to the active labels; ignore stale responses.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    runSearch(q, { labels: active })
      .then((res) => !cancelled && setHits(res))
      .catch(() => !cancelled && setHits([]));
    return () => {
      cancelled = true;
    };
  }, [query, active]);

  if (loading) return <div className={styles.dim}>Loading…</div>;

  const toggle = (l: string) =>
    setExtra((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  const searching = query.trim().length > 0;

  return (
    <div className={styles.list}>
      <h1 className={styles.pageTitle}>
        <span className={styles.dim}>label:</span> {label}
      </h1>

      <div className={styles.facetActive}>
        {extra.map((l) => (
          <button key={l} className={styles.facetChipOn} onClick={() => toggle(l)}>
            {l} ✕
          </button>
        ))}
      </div>

      {cooccurring.length > 0 && (
        <div className={styles.facetBar}>
          <span className={styles.facetLead}>Narrow by</span>
          {cooccurring.map(([l, count]) => (
            <button key={l} className={styles.facetChip} onClick={() => toggle(l)}>
              {l}
              <span className={styles.facetCount}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <input
        className={styles.filterInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search within ${active.join(" + ")}…`}
      />

      <p className={styles.resultMeta}>
        {searching
          ? `${hits.length} match${hits.length === 1 ? "" : "es"}`
          : `${matched.length} note${matched.length === 1 ? "" : "s"}`}
      </p>

      {searching
        ? hits.map((h) => (
            <Link key={`${h.id}#${h.nodeId ?? ""}`} to={noteLink(h, h.nodeId)} className={styles.row}>
              <div className={styles.rowTitle}>{h.title}</div>
              {h.snippet && <div className={styles.rowSummary}>{h.snippet}</div>}
            </Link>
          ))
        : matched.map((n: NoteMeta) => (
            <Link key={n.id} to={noteLink(n)} className={styles.row}>
              <div className={styles.rowTitle}>{n.title}</div>
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

      {!searching && matched.length === 0 && <div className={styles.dim}>No notes match.</div>}
    </div>
  );
}
