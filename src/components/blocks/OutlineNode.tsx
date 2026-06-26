import { AnimatePresence, motion } from "framer-motion";
import type { OutlineNode as OutlineNodeType } from "../../lib/schema.ts";
import { BlockRenderer } from "./BlockRenderer.tsx";
import { useTree } from "./context.ts";
import styles from "./blocks.module.css";

export function OutlineNode({ node, path }: { node: OutlineNodeType; path: string }) {
  const { isOpen, toggle } = useTree();
  const children = node.children ?? [];
  const hasChildren = children.length > 0;

  if (!hasChildren) {
    return (
      <div className={styles.leaf}>
        <span className={styles.bullet} />
        <span>
          {node.text}
          {node.note && <em className={styles.note}> — {node.note}</em>}
        </span>
      </div>
    );
  }

  const open = isOpen(path);

  return (
    <div className={styles.branch}>
      <button
        className={styles.branchHeader}
        onClick={() => toggle(path)}
        aria-expanded={open}
      >
        <motion.span
          className={styles.caret}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          ▸
        </motion.span>
        <span>{node.text}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.children}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            {children.map((child, i) => (
              <BlockRenderer key={i} node={child} path={`${path}.${i}`} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
