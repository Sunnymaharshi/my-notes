import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useContent } from "../lib/useContent.ts";
import { useTheme } from "../lib/useTheme.ts";
import { useDensity } from "../lib/useDensity.ts";
import { useBookmarks } from "../lib/bookmarks.ts";
import type { NoteMeta } from "../lib/schema.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import styles from "./Layout.module.css";

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export function Layout() {
  const { index, categories, domains } = useContent();
  const { theme, toggle } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  const bookmarkIds = useBookmarks();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [pathname]);

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

  // Sidebar nav nested as domain → category → notes.
  const grouped = useMemo(() => {
    const byCat = new Map<string, NoteMeta[]>();
    for (const n of index) {
      const list = byCat.get(n.category) ?? [];
      list.push(n);
      byCat.set(n.category, list);
    }
    const catById = new Map(categories.map((c) => [c.id, c]));
    const catGroups = [...byCat.entries()].map(([id, notes]) => {
      const c = catById.get(id);
      return {
        id,
        label: c?.label ?? id,
        domain: c?.domain ?? "other",
        order: c?.order ?? 99,
        notes: notes.sort((a, b) => a.title.localeCompare(b.title)),
      };
    });

    const domById = new Map(domains.map((d) => [d.id, d]));
    const byDomain = new Map<string, typeof catGroups>();
    for (const g of catGroups) {
      const arr = byDomain.get(g.domain) ?? [];
      arr.push(g);
      byDomain.set(g.domain, arr);
    }
    return [...byDomain.entries()]
      .map(([domId, cats]) => ({
        id: domId,
        label: domById.get(domId)?.label ?? "Other",
        order: domById.get(domId)?.order ?? 99,
        cats: cats.sort((a, b) => a.order - b.order),
      }))
      .sort((a, b) => a.order - b.order);
  }, [index, categories, domains]);

  // Resolve bookmarked ids to their metadata, preserving most-recent-first order.
  const byId = useMemo(() => new Map(index.map((n) => [n.id, n])), [index]);
  const bookmarks = useMemo(
    () => bookmarkIds.map((id) => byId.get(id)).filter((n): n is NoteMeta => Boolean(n)),
    [bookmarkIds, byId],
  );

  return (
    <div className={styles.shell}>
      <button
        className={styles.menuBtn}
        onClick={() => setNavOpen((o) => !o)}
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
      >
        {navOpen ? "✕" : "☰"}
      </button>
      {navOpen && <div className={styles.scrim} onClick={() => setNavOpen(false)} />}
      <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.topBar}>
          <Link to="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true" />
            <span>
              notes<span className={styles.brandDim}>/fm</span>
            </span>
          </Link>
          <div className={styles.toggles}>
            <Tooltip
              label={density === "compact" ? "Comfortable spacing" : "Compact spacing"}
            >
              <button
                className={styles.themeToggle}
                onClick={toggleDensity}
                aria-label="Toggle density"
                aria-pressed={density === "compact"}
              >
                {density === "compact" ? "≣" : "☰"}
              </button>
            </Tooltip>
            <Tooltip label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              <button className={styles.themeToggle} onClick={toggle} aria-label="Toggle theme">
                {theme === "dark" ? "☀" : "☾"}
              </button>
            </Tooltip>
          </div>
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
        <nav className={styles.nav}>
          {grouped.map((dom) => (
            <div key={dom.id} className={styles.domain}>
              <span className={styles.domainLabel}>{dom.label}</span>
              {dom.cats.map((cat) => (
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
            </div>
          ))}
        </nav>
      </aside>
      <main className={styles.main}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <Outlet />
        </motion.div>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
