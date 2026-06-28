import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BlockNode, Note } from "../../lib/schema.ts";
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
 * Always expand at the root (body) level so ↑/↓ steps through the note's
 * top-level topics regardless of how deep the resolved topic sits.
 */
function getSiblingContext(body: BlockNode[], topicPath: string) {
  const rootIdx = Number(topicPath.split(".")[0]);
  return { siblings: body, currentIdx: rootIdx, siblingPath: "" };
}

export function TopicView({ note, path }: Props) {
  const resolved = useMemo(() => resolveTopic(note.body, path), [note, path]);
  const [extraAbove, setExtraAbove] = useState(0);
  const [extraBelow, setExtraBelow] = useState(0);

  // Reset expansion state when the path changes (new deep-link).
  useEffect(() => {
    setExtraAbove(0);
    setExtraBelow(0);
  }, [path]);

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

  const siblingCtx = useMemo(
    () => (resolved ? getSiblingContext(note.body, resolved.path) : null),
    [note.body, resolved],
  );

  if (!resolved || !siblingCtx) {
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
  const children = node.type === "outline" ? (node.children ?? []) : null;

  const { siblings, currentIdx, siblingPath } = siblingCtx;
  const sibPrefix = siblingPath ? `${siblingPath}.` : "";

  const aboveStart = Math.max(0, currentIdx - extraAbove);
  const canExpandAbove = aboveStart > 0;
  const canExpandBelow = currentIdx + extraBelow + 1 < siblings.length;

  const aboveNodes = siblings.slice(aboveStart, currentIdx);
  const belowNodes = siblings.slice(currentIdx + 1, currentIdx + 1 + extraBelow);

  return (
    <div className={styles.topic}>
      <div className={styles.upbar}>
        <Link to={noteBase} className={styles.up}>
          ↑ Full note
        </Link>
      </div>

      <TreeContext.Provider value={openTree}>
        {/* Expand above */}
        {canExpandAbove && (
          <button className={styles.expandBtn} onClick={() => setExtraAbove((n) => n + 1)}>
            ↑ Expand
          </button>
        )}

        {/* Siblings rendered above the focused topic */}
        {aboveNodes.map((sibling, i) => {
          const sibPath = `${sibPrefix}${aboveStart + i}`;
          return (
            <div key={sibPath} className={styles.sibling}>
              <BlockRenderer node={sibling} path={sibPath} />
            </div>
          );
        })}

        {/* Divider marking the focused topic */}
        <div className={styles.focusedTopic}>
          {trail.map((c) => (
            <div key={c.path} className={styles.ancestor}>{c.text}</div>
          ))}
          <h2 className={styles.heading} id={nodeAnchorId(topicPath)}>
            {heading}
          </h2>
          <div className={styles.body}>
            {children
              ? children.map((child, i) => (
                  <BlockRenderer key={i} node={child} path={`${topicPath}.${i}`} />
                ))
              : <BlockRenderer node={node} path={topicPath} />}
          </div>
        </div>

        {/* Siblings rendered below the focused topic */}
        {belowNodes.map((sibling, i) => {
          const sibPath = `${sibPrefix}${currentIdx + 1 + i}`;
          return (
            <div key={sibPath} className={styles.sibling}>
              <BlockRenderer node={sibling} path={sibPath} />
            </div>
          );
        })}

        {/* Expand below */}
        {canExpandBelow && (
          <button className={styles.expandBtn} onClick={() => setExtraBelow((n) => n + 1)}>
            ↓ Expand
          </button>
        )}
      </TreeContext.Provider>
    </div>
  );
}
