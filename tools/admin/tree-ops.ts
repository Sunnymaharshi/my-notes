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
