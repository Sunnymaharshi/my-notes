import type { PreNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

export function PreBlock({ node }: { node: PreNode }) {
  return <pre className={styles.pre}>{node.text}</pre>;
}
