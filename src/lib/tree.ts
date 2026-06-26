import type { BlockNode } from "./schema.ts";

export interface BranchPath {
  path: string;
  depth: number;
}

/**
 * Collect the paths of every collapsible branch (outline node with children).
 * Paths mirror how BlockRenderer assigns them: top-level index "i", child "i.j", etc.
 * Indices count all sibling nodes (any type) so paths stay in sync with rendering.
 */
export function collectBranchPaths(body: BlockNode[]): BranchPath[] {
  const out: BranchPath[] = [];
  const walk = (nodes: BlockNode[], prefix: string, depth: number) => {
    nodes.forEach((node, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (node.type === "outline" && node.children && node.children.length > 0) {
        out.push({ path, depth });
        walk(node.children, path, depth + 1);
      }
    });
  };
  walk(body, "", 0);
  return out;
}
