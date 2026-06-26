import type { LinkNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

export function LinkBlock({ node }: { node: LinkNode }) {
  return (
    <a className={styles.link} href={node.url} target="_blank" rel="noreferrer noopener">
      <span className={styles.linkIcon} aria-hidden>↗</span>
      <span className={styles.linkText}>{node.text || node.url}</span>
    </a>
  );
}
