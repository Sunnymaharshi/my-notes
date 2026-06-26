import { useState } from "react";
import { motion } from "framer-motion";
import type { FlashcardNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

// Click to reveal — doubles as a self-test in revision.
export function Flashcard({ node }: { node: FlashcardNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      className={styles.flashcard}
      onClick={() => setRevealed((r) => !r)}
      aria-expanded={revealed}
    >
      <div className={styles.flashcardQ}>
        <span className={styles.flashcardTag}>Q</span>
        {node.q}
      </div>
      <motion.div
        initial={false}
        animate={{ height: revealed ? "auto" : 0, opacity: revealed ? 1 : 0 }}
        transition={{ duration: 0.18 }}
        style={{ overflow: "hidden" }}
      >
        <div className={styles.flashcardA}>
          <span className={styles.flashcardTag}>A</span>
          {node.a}
        </div>
      </motion.div>
      {!revealed && <div className={styles.flashcardHint}>click to reveal</div>}
    </button>
  );
}
