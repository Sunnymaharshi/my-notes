import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useContent, categoryLabel } from "../lib/useContent.ts";
import { runSearch, noteLink, type SearchHit } from "../lib/search.ts";
import styles from "./CommandPalette.module.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RECENTS_KEY = "recent-searches";
const RECENTS_MAX = 6;

function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const next = [q, ...loadRecents().filter((r) => r !== q)].slice(0, RECENTS_MAX);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Split `text` into segments, wrapping any run that matches a query term in <mark>. */
function highlight(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (escaped.length === 0) return text;
  const splitRe = new RegExp(`(${escaped.join("|")})`, "gi");
  const isMatch = new RegExp(`^(?:${escaped.join("|")})$`, "i");
  return text.split(splitRe).map((p, i) =>
    p && isMatch.test(p) ? (
      <mark key={i} className={styles.mark}>
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * Cmd-K / "/" command palette (PLAN §4). Type-ahead search over the prebuilt
 * MiniSearch index; results deep-link to the matched subtopic and bold the
 * matched terms. With no query it offers recent searches, then all notes.
 */
export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { index, categories } = useContent();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);

  // Reset the query (and refresh recents) each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setRecents(loadRecents());
    }
  }, [open]);

  // Run the search whenever the (trimmed) query changes; ignore stale responses.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    runSearch(q)
      .then((res) => !cancelled && setHits(res))
      .catch(() => !cancelled && setHits([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const allNotes = useMemo(
    () => [...index].sort((a, b) => a.title.localeCompare(b.title)),
    [index],
  );

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const go = (to: string) => {
    const q = query.trim();
    if (q) setRecents(pushRecent(q));
    onOpenChange(false);
    navigate(to);
  };

  const clearRecents = () => {
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* ignore */
    }
    setRecents([]);
  };

  const showHits = query.trim().length > 0;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search notes"
      shouldFilter={false}
      className={styles.command}
      overlayClassName={styles.overlay}
      contentClassName={styles.dialog}
    >
      <div className={styles.inputRow}>
        <span className={styles.inputIcon} aria-hidden="true">
          ⌕
        </span>
        <Command.Input
          className={styles.input}
          value={query}
          onValueChange={setQuery}
          placeholder="Search notes…"
          autoFocus
        />
        {searching && <span className={styles.spinner} aria-hidden="true" />}
      </div>
      <Command.List className={styles.list}>
        {showHits ? (
          <>
            {!searching && (
              <Command.Empty className={styles.empty}>
                No matches for “{query.trim()}”.
              </Command.Empty>
            )}
            {hits.map((h) => (
              <Command.Item
                key={`${h.id}#${h.nodeId ?? ""}`}
                value={`${h.id}#${h.nodeId ?? ""}`}
                onSelect={() => go(noteLink(h, h.nodeId))}
                className={styles.item}
              >
                <div className={styles.itemHead}>
                  {h.nodeId ? (
                    <>
                      <span className={styles.itemTitle}>{highlight(h.snippet, terms)}</span>
                      <span className={styles.noteCtx}>{h.title}</span>
                    </>
                  ) : (
                    <span className={styles.itemTitle}>{highlight(h.title, terms)}</span>
                  )}
                  <span className={styles.cat}>{categoryLabel(categories, h.category)}</span>
                </div>
                {!h.nodeId && h.snippet && (
                  <div className={styles.snippet}>{highlight(h.snippet, terms)}</div>
                )}
              </Command.Item>
            ))}
          </>
        ) : (
          <>
            {recents.length > 0 && (
              <Command.Group
                heading={
                  <span className={styles.groupHeadRow}>
                    Recent
                    <button className={styles.clearBtn} onClick={clearRecents} type="button">
                      Clear
                    </button>
                  </span>
                }
                className={styles.group}
              >
                {recents.map((r) => (
                  <Command.Item
                    key={`recent:${r}`}
                    value={`recent:${r}`}
                    onSelect={() => setQuery(r)}
                    className={styles.recentItem}
                  >
                    <span className={styles.recentIcon} aria-hidden="true">
                      ↩
                    </span>
                    {r}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Jump to a note" className={styles.group}>
              {allNotes.map((n) => (
                <Command.Item
                  key={n.id}
                  value={n.id}
                  onSelect={() => go(noteLink(n))}
                  className={styles.item}
                >
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{n.title}</span>
                    <span className={styles.cat}>{categoryLabel(categories, n.category)}</span>
                  </div>
                  {n.summary && <div className={styles.snippet}>{n.summary}</div>}
                </Command.Item>
              ))}
            </Command.Group>
          </>
        )}
      </Command.List>
      <div className={styles.footer}>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
    </Command.Dialog>
  );
}
