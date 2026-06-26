import type { TextNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

/** Free-form prose paragraph. Blank lines split into separate paragraphs. */
export function TextBlock({ node }: { node: TextNode }) {
  const paras = node.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={styles.prose}>
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
