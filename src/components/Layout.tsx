import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useContent } from "../lib/useContent.ts";
import { useTheme } from "../lib/useTheme.ts";
import { useBookmarks } from "../lib/bookmarks.ts";
import type { NoteMeta } from "../lib/schema.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import styles from "./Layout.module.css";

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export function Layout() {
  const { index, categories } = useContent();
  const { theme, toggle } = useTheme();
  const bookmarkIds = useBookmarks();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global shortcuts: Cmd/Ctrl-K toggles, "/" opens (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "/" && !paletteOpen && !isTypingTarget(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const grouped = useMemo(() => {
    const byCat = new Map<string, NoteMeta[]>();
    for (const n of index) {
      const list = byCat.get(n.category) ?? [];
      list.push(n);
      byCat.set(n.category, list);
    }
    const order = new Map(categories.map((c) => [c.id, c]));
    return [...byCat.entries()]
      .map(([id, notes]) => ({
        id,
        label: order.get(id)?.label ?? id,
        order: order.get(id)?.order ?? 99,
        notes: notes.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.order - b.order);
  }, [index, categories]);

  // Resolve bookmarked ids to their metadata, preserving most-recent-first order.
  const byId = useMemo(() => new Map(index.map((n) => [n.id, n])), [index]);
  const bookmarks = useMemo(
    () => bookmarkIds.map((id) => byId.get(id)).filter((n): n is NoteMeta => Boolean(n)),
    [bookmarkIds, byId],
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.topBar}>
          <Link to="/" className={styles.brand}>
            my-notes
          </Link>
          <button
            className={styles.themeToggle}
            onClick={toggle}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
        <button className={styles.search} onClick={() => setPaletteOpen(true)}>
          <span className={styles.searchIcon}>⌕</span>
          <span>Search</span>
          <kbd className={styles.kbd}>⌘K</kbd>
        </button>
        {bookmarks.length > 0 && (
          <div className={styles.group}>
            <span className={styles.groupLabel}>★ Bookmarks</span>
            {bookmarks.map((n) => (
              <NavLink
                key={n.id}
                to={`/${n.category}/${n.id}`}
                className={({ isActive }) =>
                  `${styles.noteLink} ${isActive ? styles.active : ""}`
                }
              >
                {n.title}
              </NavLink>
            ))}
          </div>
        )}
        <nav>
          {grouped.map((cat) => (
            <div key={cat.id} className={styles.group}>
              <Link to={`/${cat.id}`} className={styles.groupLabel}>
                {cat.label}
              </Link>
              {cat.notes.map((n) => (
                <NavLink
                  key={n.id}
                  to={`/${n.category}/${n.id}`}
                  className={({ isActive }) =>
                    `${styles.noteLink} ${isActive ? styles.active : ""}`
                  }
                >
                  {n.title}
                  {n.draft && <span className={styles.dot} title="draft">●</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
