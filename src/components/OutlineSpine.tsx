import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { BlockNode, Note } from "../lib/schema.ts";
import { nodeAnchorId } from "../lib/search.ts";
import noteStyles from "./NoteView.module.css";
import styles from "./OutlineSpine.module.css";

interface SpineItem {
  path: string;
  text: string;
  depth: number;
}

/** Collect the note's topics (role: "topic") as a flat, depth-aware list.
 *  Falls back to top-level outline branches for untagged/legacy notes. */
function collectTopics(body: BlockNode[]): SpineItem[] {
  const topics: SpineItem[] = [];
  const walk = (nodes: BlockNode[], prefix: string, depth: number) => {
    nodes.forEach((node, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      let nextDepth = depth;
      if (node.type === "outline" && node.role === "topic") {
        topics.push({ path, text: node.text, depth: Math.min(depth, 1) });
        nextDepth = depth + 1;
      }
      if (node.type === "outline" && node.children) walk(node.children, path, nextDepth);
    });
  };
  walk(body, "", 0);
  if (topics.length > 0) return topics;

  // Fallback: top-level outline nodes that have children.
  return body.flatMap((node, i) =>
    node.type === "outline" && node.children?.length
      ? [{ path: String(i), text: node.text, depth: 0 }]
      : [],
  );
}

/**
 * The outline spine — the signature reading aid. Lists the note's topics with a
 * live indicator that tracks scroll position (IntersectionObserver), jumps to a
 * topic on click, and copies a deep link per topic. Hidden on narrow screens.
 */
export function OutlineSpine({ note, view }: { note: Note; view: string }) {
  const topics = useMemo(() => collectTopics(note.body), [note.body]);
  const [active, setActive] = useState<string | null>(topics[0]?.path ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number>();

  // Scroll-spy: the active topic is the topmost one currently in the upper band
  // of the viewport. Re-runs when the note or view changes (anchors remount).
  useEffect(() => {
    if (topics.length === 0) return;
    setActive(topics[0].path);
    const tops = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const path = e.target.getAttribute("data-topic");
          if (!path) continue;
          if (e.isIntersecting) tops.set(path, e.boundingClientRect.top);
          else tops.delete(path);
        }
        let best: string | null = null;
        let bestTop = Infinity;
        for (const [p, top] of tops) {
          if (top < bestTop) {
            bestTop = top;
            best = p;
          }
        }
        if (best) setActive(best);
      },
      { rootMargin: "-12% 0px -68% 0px", threshold: 0 },
    );
    for (const t of topics) {
      const el = document.getElementById(nodeAnchorId(t.path));
      if (el) {
        el.setAttribute("data-topic", t.path);
        io.observe(el);
      }
    }
    return () => io.disconnect();
  }, [topics, view, note.id]);

  const jump = (path: string) => {
    const el = document.getElementById(nodeAnchorId(path));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add(noteStyles.flash);
    window.setTimeout(() => el.classList.remove(noteStyles.flash), 1700);
    setActive(path);
  };

  // Step to the prev/next topic relative to the active one (clamped to the ends).
  const activeIdx = topics.findIndex((t) => t.path === active);
  const step = (delta: number) => {
    const next = activeIdx + delta;
    if (next >= 0 && next < topics.length) jump(topics[next].path);
  };

  // Keyboard: "[" / "]" walk topics — turning the note into a guided path.
  useEffect(() => {
    if (topics.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      )
        return;
      if (e.key === "[") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdx, topics]);

  const copyLink = (path: string) => {
    const url = `${location.origin}${location.pathname}#${nodeAnchorId(path)}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(path);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1400);
    });
  };

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  if (topics.length < 2) return null;

  return (
    <nav className={styles.spine} aria-label="On this page">
      <div className={styles.head}>On this page</div>
      <ul className={styles.rail}>
        {topics.map((t) => {
          const isActive = t.path === active;
          return (
            <li key={t.path} className={styles.item}>
              {isActive && (
                <motion.span
                  layoutId="spine-dot"
                  className={styles.dot}
                  transition={{ type: "spring", stiffness: 520, damping: 38 }}
                />
              )}
              <button
                className={`${styles.link} ${t.depth > 0 ? styles.depth1 : ""} ${
                  isActive ? styles.active : ""
                }`}
                onClick={() => jump(t.path)}
                aria-current={isActive ? "true" : undefined}
              >
                {t.text}
              </button>
              <button
                className={`${styles.copy} ${copied === t.path ? styles.copied : ""}`}
                onClick={() => copyLink(t.path)}
                aria-label="Copy link to this topic"
                title="Copy deep link"
              >
                {copied === t.path ? "✓" : "⧉"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.steps}>
        <button
          className={styles.step}
          onClick={() => step(-1)}
          disabled={activeIdx <= 0}
          aria-label="Previous topic"
        >
          ↑ Prev
        </button>
        <button
          className={styles.step}
          onClick={() => step(1)}
          disabled={activeIdx < 0 || activeIdx >= topics.length - 1}
          aria-label="Next topic"
        >
          Next ↓
        </button>
        <kbd className={styles.stepKbd}>[ ]</kbd>
      </div>
    </nav>
  );
}
