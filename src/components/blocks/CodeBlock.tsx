import { useState } from "react";
import type { CodeNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

export function CodeBlock({ node }: { node: CodeNode }) {
  // Long code is capped to a scrollable viewport; "expand" lets it grow to full height.
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${styles.code} ${expanded ? styles.codeExpanded : ""}`}>
      {node.codeHtml ? (
        // Pre-highlighted server-side (Shiki); no highlighter ships to the client.
        <div className={styles.shiki} dangerouslySetInnerHTML={{ __html: node.codeHtml }} />
      ) : (
        <pre className={styles.codePlain}>
          <code>{node.code}</code>
        </pre>
      )}
      <button className={styles.codeExpandBtn} onClick={() => setExpanded((v) => !v)}>
        {expanded ? "collapse" : "expand"}
      </button>
    </div>
  );
}
