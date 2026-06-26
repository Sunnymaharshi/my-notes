import { useState } from "react";
import type { CodeNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

export function CodeBlock({ node }: { node: CodeNode }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(node.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={styles.code}>
      <div className={styles.codeBar}>
        <span className={styles.codeLang}>{node.filename ?? node.lang}</span>
        <button className={styles.copyBtn} onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {node.codeHtml ? (
        // Pre-highlighted server-side (Shiki); no highlighter ships to the client.
        <div className={styles.shiki} dangerouslySetInnerHTML={{ __html: node.codeHtml }} />
      ) : (
        <pre className={styles.codePlain}>
          <code>{node.code}</code>
        </pre>
      )}
    </div>
  );
}
