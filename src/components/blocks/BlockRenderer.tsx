import type { BlockNode } from "../../lib/schema.ts";
import { nodeAnchorId } from "../../lib/search.ts";
import { OutlineNode } from "./OutlineNode.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { Callout } from "./Callout.tsx";
import { TableBlock } from "./TableBlock.tsx";
import { Flashcard } from "./Flashcard.tsx";
import { ImageBlock } from "./ImageBlock.tsx";

function render(node: BlockNode, path: string) {
  switch (node.type) {
    case "outline":
      return <OutlineNode node={node} path={path} />;
    case "code":
      return <CodeBlock node={node} />;
    case "callout":
      return <Callout node={node} />;
    case "table":
      return <TableBlock node={node} />;
    case "flashcard":
      return <Flashcard node={node} />;
    case "image":
      return <ImageBlock node={node} />;
  }
}

// Maps a block node to its renderer. `path` is the node's position in the tree (e.g. "1.2");
// the wrapper carries `id="n1.2"` so search results can deep-link to (and flash) the node.
export function BlockRenderer({ node, path }: { node: BlockNode; path: string }) {
  return <div id={nodeAnchorId(path)}>{render(node, path)}</div>;
}
