import { Fragment, type ReactNode } from "react";
import type { BlockNode, Note, OutlineNode } from "../../lib/schema.ts";
import { CodeBlock } from "../blocks/CodeBlock.tsx";
import { Callout } from "../blocks/Callout.tsx";
import { TextBlock } from "../blocks/TextBlock.tsx";
import { TableBlock } from "../blocks/TableBlock.tsx";
import { Flashcard } from "../blocks/Flashcard.tsx";
import { ImageBlock } from "../blocks/ImageBlock.tsx";
import styles from "./views.module.css";

const isLeafOutline = (n: BlockNode): boolean =>
  n.type === "outline" && !(n.children && n.children.length > 0);

// Heading level for an outline section, capped so deep trees stay readable.
const heading = (depth: number) =>
  (`h${Math.min(depth + 2, 6)}` as "h2" | "h3" | "h4" | "h5" | "h6");

function nonOutline(node: BlockNode, key: number): ReactNode {
  switch (node.type) {
    case "code":
      return <CodeBlock key={key} node={node} />;
    case "callout":
      return <Callout key={key} node={node} />;
    case "text":
      return <TextBlock key={key} node={node} />;
    case "table":
      return <TableBlock key={key} node={node} />;
    case "flashcard":
      return <Flashcard key={key} node={node} />;
    case "image":
      return <ImageBlock key={key} node={node} />;
    default:
      return null;
  }
}

// Render a sibling list at `depth`, grouping runs of leaf outlines into a single <ul>.
function renderNodes(nodes: BlockNode[], depth: number): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];

    if (isLeafOutline(node)) {
      const items: OutlineNode[] = [];
      while (i < nodes.length && isLeafOutline(nodes[i])) {
        items.push(nodes[i] as OutlineNode);
        i++;
      }
      out.push(
        <ul key={`ul-${i}`} className={styles.docList}>
          {items.map((it, j) => (
            <li key={j}>
              {it.text}
              {it.note && <em className={styles.docNote}> — {it.note}</em>}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (node.type === "outline") {
      const H = heading(depth);
      out.push(
        <section key={`s-${i}`} className={styles.docSection}>
          <H className={styles.docHeading}>{node.text}</H>
          {node.note && <p className={styles.docNote}>{node.note}</p>}
          {renderNodes(node.children ?? [], depth + 1)}
        </section>,
      );
      i++;
      continue;
    }

    out.push(<Fragment key={`b-${i}`}>{nonOutline(node, i)}</Fragment>);
    i++;
  }
  return out;
}

/** Flowing document view: the outline tree as headings + prose, fully expanded. */
export function DocView({ note }: { note: Note }) {
  return <div className={styles.doc}>{renderNodes(note.body, 0)}</div>;
}
