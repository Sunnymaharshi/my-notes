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

/**
 * Cmd-K / "/" command palette (PLAN §4). Type-ahead search over the prebuilt
 * MiniSearch index; results deep-link to the matched subtopic. With no query it
 * lists all notes for quick jumping. cmdk's own filter is disabled — MiniSearch
 * ranks the hits, and the empty-state list is shown verbatim.
 */
export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { index, categories } = useContent();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset the query each time the palette opens.
  useEffect(() => {
    if (open) setQuery("");
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

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
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
      <Command.Input
        className={styles.input}
        value={query}
        onValueChange={setQuery}
        placeholder="Search notes…  (try a keyword, label, or code symbol)"
        autoFocus
      />
      <Command.List className={styles.list}>
        {showHits ? (
          <>
            {!searching && (
              <Command.Empty className={styles.empty}>No matches for “{query}”.</Command.Empty>
            )}
            {hits.map((h) => (
              <Command.Item
                key={`${h.id}#${h.nodeId ?? ""}`}
                value={`${h.id}#${h.nodeId ?? ""}`}
                onSelect={() => go(noteLink(h, h.nodeId))}
                className={styles.item}
              >
                <div className={styles.itemHead}>
                  <span className={styles.itemTitle}>{h.title}</span>
                  <span className={styles.cat}>{categoryLabel(categories, h.category)}</span>
                </div>
                {h.snippet && <div className={styles.snippet}>{h.snippet}</div>}
              </Command.Item>
            ))}
          </>
        ) : (
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
