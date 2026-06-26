import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { Note } from "../../lib/schema.ts";
import { resolveTopic } from "../../lib/tree.ts";
import { nodeAnchorId } from "../../lib/search.ts";
import { BlockRenderer } from "../blocks/BlockRenderer.tsx";
import { TreeContext } from "../blocks/context.ts";
import styles from "./TopicView.module.css";
import noteStyles from "../NoteView.module.css";

const openTree = { isOpen: () => true, toggle: () => {} };

interface Props {
  note: Note;
  /** positional path from the URL hash, e.g. "0.2.1" (without the leading "n") */
  path: string;
}

/**
 * Focused view shown when a search hit deep-links into a note. Resolves the matched
 * path UP to its nearest enclosing topic and renders just that topic (fully expanded),
 * flashing the exact line that matched. The ancestor-topic trail lets the reader widen
 * ("go up") to a broader topic or the full note.
 */
export function TopicView({ note, path }: Props) {
  const resolved = useMemo(() => resolveTopic(note.body, path), [note, path]);

  // Flash the exact matched node inside the shown topic (it's already expanded).
  useEffect(() => {
    if (!resolved) return;
    const anchor = nodeAnchorId(path);
    let tries = 0;
    let timer = window.setTimeout(function find() {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(noteStyles.flash);
        window.setTimeout(() => el.classList.remove(noteStyles.flash), 1600);
      } else if (tries++ < 12) {
        timer = window.setTimeout(find, 60);
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [resolved, path]);

  if (!resolved) {
    return (
      <div className={styles.missing}>
        <p>Topic not found.</p>
        <Link to={`/${note.category}/${note.id}`} className={styles.back}>
          ← View full note
        </Link>
      </div>
    );
  }

  const { node, path: topicPath, trail } = resolved;
  const heading = node.type === "outline" ? node.text : "Topic";
  const noteBase = `/${note.category}/${note.id}`;
  // Render the topic's children (the heading is shown separately as <h2>); if the
  // resolved node isn't an outline (rare), render the node itself.
  const children = node.type === "outline" ? (node.children ?? []) : null;

  return (
    <div className={styles.topic}>
      {/* "Go up": the full note, then each broader ancestor topic. */}
      <div className={styles.upbar}>
        <Link to={noteBase} className={styles.up}>
          ↑ Full note
        </Link>
        {trail.map((c) => (
          <span key={c.path} className={styles.upStep}>
            <span className={styles.sep}>›</span>
            <Link to={`${noteBase}#${nodeAnchorId(c.path)}`} className={styles.up}>
              {c.text}
            </Link>
          </span>
        ))}
      </div>

      {/* id so a search that matches the topic heading itself can be flashed */}
      <h2 className={styles.heading} id={nodeAnchorId(topicPath)}>
        {heading}
      </h2>

      <TreeContext.Provider value={openTree}>
        <div className={styles.body}>
          {children
            ? children.map((child, i) => (
                <BlockRenderer key={i} node={child} path={`${topicPath}.${i}`} />
              ))
            : <BlockRenderer node={node} path={topicPath} />}
        </div>
      </TreeContext.Provider>
    </div>
  );
}
