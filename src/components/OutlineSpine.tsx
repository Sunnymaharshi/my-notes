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
  // While a programmatic scroll is in flight, suppress scroll-spy updates so
  // the dot doesn't bounce through intermediate sections on its way to the target.
  const jumping = useRef(false);
  const jumpTimer = useRef<number>();

  // Scroll-spy: find the last topic anchor whose top edge is above 35% of the
  // viewport height. This gives a stable "you are reading this section" signal
  // without flickering when two headings are simultaneously near the top.
  useEffect(() => {
    if (topics.length === 0) return;
    setActive(topics[0].path);

    const scroller = document.querySelector<HTMLElement>("[data-scroll-spy]");
    const root = scroller ?? window;

    const getActive = () => {
      if (jumping.current) return;
      const threshold = window.innerHeight * 0.35;
      let current: string | null = topics[0].path;
      for (const t of topics) {
        const el = document.getElementById(nodeAnchorId(t.path));
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= threshold) current = t.path;
      }
      setActive(current);
    };

    let raf: number;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      // If a jump is in flight, reset the idle timer on every scroll event so
      // the lock only lifts after scroll events actually stop arriving.
      if (jumping.current) {
        window.clearTimeout(jumpTimer.current);
        jumpTimer.current = window.setTimeout(() => { jumping.current = false; }, 120);
        return;
      }
      raf = requestAnimationFrame(getActive);
    };

    getActive();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [topics, view, note.id]);

  const jump = (path: string) => {
    const el = document.getElementById(nodeAnchorId(path));
    if (!el) return;
    // Lock the dot on the target immediately. The scroll listener will keep
    // resetting the 120 ms idle timer until scrolling stops, then unlock.
    jumping.current = true;
    window.clearTimeout(jumpTimer.current);
    jumpTimer.current = window.setTimeout(() => { jumping.current = false; }, 120);
    setActive(path);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add(noteStyles.flash);
    window.setTimeout(() => el.classList.remove(noteStyles.flash), 1700);
  };

  useEffect(() => () => window.clearTimeout(jumpTimer.current), []);


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
    </nav>
  );
}
