/**
 * Immutable edits to a note's `body` block-tree, addressed by the same positional path
 * scheme used everywhere else ("1", "1.2", "1.2.0"). Each op deep-clones then mutates the
 * clone, so React state updates stay simple. Notes are small; cloning is cheap.
 *
 * Only `outline` nodes have children, so indent/append target outline ancestors.
 */
import type { BlockNode, OutlineNode } from "../../src/lib/schema.ts";

const clone = (body: BlockNode[]): BlockNode[] => structuredClone(body);

const parts = (path: string) => path.split(".").map(Number);

/** Navigate to the list (and index within it) that holds the node at `path`. */
function locate(body: BlockNode[], path: string): { list: BlockNode[]; index: number } {
  const p = parts(path);
  let list = body;
  for (let i = 0; i < p.length - 1; i++) {
    list = (list[p[i]] as OutlineNode).children!;
  }
  return { list, index: p[p.length - 1] };
}

export function getAt(body: BlockNode[], path: string): BlockNode | undefined {
  const { list, index } = locate(body, path);
  return list?.[index];
}

/** A short, human label for a node — used in the insert-target picker. */
export function nodeLabel(node: BlockNode): string {
  switch (node.type) {
    case "outline":
      return node.text || "(empty outline)";
    case "text":
      return node.text.slice(0, 60) || "(empty text)";
    case "code":
      return `code · ${node.lang}`;
    case "callout":
      return `${node.variant}: ${node.text.slice(0, 40)}`;
    case "table":
      return `table · ${node.headers.join(", ").slice(0, 40)}`;
    case "flashcard":
      return `flashcard · ${node.q.slice(0, 40)}`;
    case "image":
      return `image · ${node.src}`;
    case "link":
      return `link · ${node.text || node.url}`;
    case "pre":
      return node.text.slice(0, 60) || "(empty pre)";
  }
}

/** Depth-first flatten of the tree to {path, depth, node} for pickers. */
export function flatten(
  body: BlockNode[],
  prefix = "",
  depth = 0,
): { path: string; depth: number; node: BlockNode }[] {
  const out: { path: string; depth: number; node: BlockNode }[] = [];
  body.forEach((node, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    out.push({ path, depth, node });
    if (node.type === "outline" && node.children?.length) {
      out.push(...flatten(node.children, path, depth + 1));
    }
  });
  return out;
}

export function replaceAt(body: BlockNode[], path: string, node: BlockNode): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  list[index] = node;
  return next;
}

export function removeAt(body: BlockNode[], path: string): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  list.splice(index, 1);
  return next;
}

/** Insert a node as the sibling immediately after `path`. */
export function insertAfter(body: BlockNode[], path: string, node: BlockNode): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  list.splice(index + 1, 0, node);
  return next;
}

/** Insert a node as the sibling immediately before `path`. */
export function insertBefore(body: BlockNode[], path: string, node: BlockNode): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  list.splice(index, 0, node);
  return next;
}

/** Insert one or more nodes relative to `path`: before it, after it, or as its children. */
export function insertNodes(
  body: BlockNode[],
  path: string,
  where: "before" | "after" | "child",
  nodes: BlockNode[],
): BlockNode[] {
  if (nodes.length === 0) return body;
  const next = clone(body);
  if (where === "child") {
    const target = getAt(next, path);
    if (target?.type !== "outline") return body; // only outlines hold children
    (target.children ??= []).push(...nodes);
    return next;
  }
  const { list, index } = locate(next, path);
  list.splice(where === "before" ? index : index + 1, 0, ...nodes);
  return next;
}

/** Append a child to the outline node at `path`. */
export function appendChild(body: BlockNode[], path: string, node: BlockNode): BlockNode[] {
  const next = clone(body);
  const target = getAt(next, path);
  if (target?.type !== "outline") return body;
  (target.children ??= []).push(node);
  return next;
}

/** Add a node at the very end of the top level. */
export function appendTop(body: BlockNode[], node: BlockNode): BlockNode[] {
  return [...clone(body), node];
}

/** Find a node's containing list + index by object identity (post-mutation safe). */
function findRef(
  list: BlockNode[],
  target: BlockNode,
): { list: BlockNode[]; index: number } | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === target) return { list, index: i };
    const child = list[i];
    if (child.type === "outline" && child.children) {
      const r = findRef(child.children, target);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Drag-and-drop move: relocate the node at `from` to sit before/after the node at `to`,
 * or as its last child. Resolves the destination by object identity *after* removing the
 * source, so sibling-index shifts can't misplace it. No-op for invalid moves (onto itself,
 * into its own subtree, or `child` onto a non-outline).
 */
export function moveNode(
  body: BlockNode[],
  from: string,
  to: string,
  where: "before" | "after" | "child",
): BlockNode[] {
  if (from === to || to.startsWith(from + ".")) return body; // self / into-own-descendant
  const next = clone(body);
  const target = getAt(next, to);
  if (!target) return body;
  if (where === "child" && target.type !== "outline") return body;

  const { list: fromList, index: fromIndex } = locate(next, from);
  const [node] = fromList.splice(fromIndex, 1);
  if (!node) return body;

  if (where === "child") {
    ((target as OutlineNode).children ??= []).push(node);
    return next;
  }
  const ref = findRef(next, target);
  if (!ref) return body;
  ref.list.splice(where === "before" ? ref.index : ref.index + 1, 0, node);
  return next;
}

/** Move a node up/down among its siblings (dir = -1 | 1). */
export function move(body: BlockNode[], path: string, dir: -1 | 1): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  const to = index + dir;
  if (to < 0 || to >= list.length) return body;
  [list[index], list[to]] = [list[to], list[index]];
  return next;
}

/** Make a node a child of its previous sibling (which must be an outline). */
export function indent(body: BlockNode[], path: string): BlockNode[] {
  const next = clone(body);
  const { list, index } = locate(next, path);
  if (index === 0) return body;
  const prev = list[index - 1];
  if (prev.type !== "outline") return body;
  const [node] = list.splice(index, 1);
  (prev.children ??= []).push(node);
  return next;
}

/** Move a node out to become the sibling after its parent. */
export function outdent(body: BlockNode[], path: string): BlockNode[] {
  const p = parts(path);
  if (p.length < 2) return body; // already top-level
  const next = clone(body);
  // grandparent list holds the parent at parentIndex
  let gList = next;
  for (let i = 0; i < p.length - 2; i++) {
    gList = (gList[p[i]] as OutlineNode).children!;
  }
  const parentIndex = p[p.length - 2];
  const parent = gList[parentIndex] as OutlineNode;
  const [node] = parent.children!.splice(p[p.length - 1], 1);
  if (parent.children!.length === 0) delete parent.children;
  gList.splice(parentIndex + 1, 0, node);
  return next;
}
