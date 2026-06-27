import { useState } from "react";
import type { CodeNode } from "../../lib/schema.ts";
import styles from "./blocks.module.css";

export function CodeBlock({ node }: { node: CodeNode }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(node.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`${styles.code} ${expanded ? styles.codeExpanded : ""}`}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{node.lang}</span>
        {node.filename && <span className={styles.codeFilename}>{node.filename}</span>}
        <span className={styles.codeHeaderSpacer} />
        <button className={styles.codeCopyBtn} onClick={copy}>
          {copied ? "copied!" : "copy"}
        </button>
        <button className={styles.codeExpandBtn} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "collapse" : "expand"}
        </button>
      </div>
      {node.codeHtml ? (
        <div className={styles.shiki} dangerouslySetInnerHTML={{ __html: node.codeHtml }} />
      ) : (
        <pre className={styles.codePlain}>
          <code>{node.code}</code>
        </pre>
      )}
    </div>
  );
}
