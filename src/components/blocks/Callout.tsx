import type { CalloutNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

const ICON: Record<CalloutNode["variant"], string> = {
  tip: "💡",
  warning: "⚠️",
  gotcha: "⚠️",
  info: "ℹ️",
  note: "📝",
};

export function Callout({ node }: { node: CalloutNode }) {
  return (
    <div className={`${styles.callout} ${styles[`callout_${node.variant}`]}`}>
      <span className={styles.calloutIcon}>{ICON[node.variant]}</span>
      <span>{node.text}</span>
    </div>
  );
}
