import type { BlockNode } from "./schema.ts";

export interface PathStep {
  path: string;
  node: BlockNode;
}

/** Walk from the body root to the node at `path`, returning each step (root → target). */
export function collectPathSteps(body: BlockNode[], path: string): PathStep[] {
  const parts = path.split(".").map(Number);
  const steps: PathStep[] = [];
  let nodes: BlockNode[] = body;
  let prefix = "";
  for (const idx of parts) {
    if (Number.isNaN(idx) || idx < 0 || idx >= nodes.length) break;
    const node = nodes[idx];
    const p = prefix ? `${prefix}.${idx}` : String(idx);
    steps.push({ path: p, node });
    prefix = p;
    nodes = node.type === "outline" && node.children ? node.children : [];
  }
  return steps;
}

const isTopic = (n: BlockNode): boolean => n.type === "outline" && n.role === "topic";
const hasChildren = (n: BlockNode): boolean =>
  n.type === "outline" && !!n.children && n.children.length > 0;

export interface TopicCrumb {
  path: string;
  text: string;
}

export interface ResolvedTopic {
  /** the node to render as the focused page */
  node: BlockNode;
  /** its positional path (the resolved page anchor) */
  path: string;
  /** ancestor topics above the shown one, shallow → deep (breadcrumb / "go up") */
  trail: TopicCrumb[];
}

/**
 * Resolve a matched path to the nearest enclosing **topic** (the showable unit).
 * Climbs from the matched node up to the nearest ancestor-or-self with role "topic".
 * If no topic is tagged on the path (legacy/untagged notes), falls back to the
 * nearest outline-with-children, then to the node itself. `trail` is the chain of
 * ancestor topics above the chosen one, so the page can offer "go up to …".
 */
export function resolveTopic(body: BlockNode[], path: string): ResolvedTopic | null {
  const steps = collectPathSteps(body, path);
  if (steps.length === 0) return null;

  const topicSteps = steps.filter((s) => isTopic(s.node));
  let chosen: PathStep;
  if (topicSteps.length > 0) {
    chosen = topicSteps[topicSteps.length - 1]; // deepest topic = nearest to the match
  } else {
    const branches = steps.filter((s) => hasChildren(s.node));
    chosen = branches.length > 0 ? branches[branches.length - 1] : steps[steps.length - 1];
  }

  const trail: TopicCrumb[] = topicSteps
    .filter((s) => s.path !== chosen.path)
    .map((s) => ({ path: s.path, text: (s.node as Extract<BlockNode, { type: "outline" }>).text }));

  return { node: chosen.node, path: chosen.path, trail };
}

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
