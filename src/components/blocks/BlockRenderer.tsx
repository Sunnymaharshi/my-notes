import type { BlockNode } from "../../lib/schema.ts";
import { nodeAnchorId } from "../../lib/search.ts";
import { OutlineNode } from "./OutlineNode.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { Callout } from "./Callout.tsx";
import { TextBlock } from "./TextBlock.tsx";
import { TableBlock } from "./TableBlock.tsx";
import { Flashcard } from "./Flashcard.tsx";
import { ImageBlock } from "./ImageBlock.tsx";
import { LinkBlock } from "./LinkBlock.tsx";
import { PreBlock } from "./PreBlock.tsx";

function render(node: BlockNode, path: string, depth: number) {
  switch (node.type) {
    case "outline":
      return <OutlineNode node={node} path={path} depth={depth} />;
    case "code":
      return <CodeBlock node={node} />;
    case "callout":
      return <Callout node={node} />;
    case "text":
      return <TextBlock node={node} />;
    case "pre":
      return <PreBlock node={node} />;
    case "table":
      return <TableBlock node={node} />;
    case "flashcard":
      return <Flashcard node={node} />;
    case "image":
      return <ImageBlock node={node} />;
    case "link":
      return <LinkBlock node={node} />;
    default:
      return (
        <p style={{ opacity: 0.6, fontStyle: "italic" }}>
          [unsupported block: {(node as { type?: string }).type ?? "unknown"}]
        </p>
      );
  }
}

// Maps a block node to its renderer. `path` is the node's position in the tree (e.g. "1.2");
// the wrapper carries `id="n1.2"` so search results can deep-link to (and flash) the node.
export function BlockRenderer({ node, path, depth = 0 }: { node: BlockNode; path: string; depth?: number }) {
  return <div id={nodeAnchorId(path)}>{render(node, path, depth)}</div>;
}
