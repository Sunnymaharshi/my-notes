import type { BlockNode } from "./schema.ts";

export interface Card {
  q: string;
  a: string;
  /** True when synthesized from an outline node's `note`, not an explicit flashcard. */
  derived?: boolean;
}

/**
 * Gather study cards from a note body for FlashcardView.
 * Prefers explicit `flashcard` nodes; if a note has none, falls back to synthesizing
 * cards from outline nodes that carry a `note` ("term — explanation" pairs), so the
 * deck is still useful for revision.
 */
export function collectCards(body: BlockNode[]): Card[] {
  const explicit: Card[] = [];
  const derived: Card[] = [];

  const walk = (nodes: BlockNode[]) => {
    for (const node of nodes) {
      if (node.type === "flashcard") {
        explicit.push({ q: node.q, a: node.a });
      } else if (node.type === "outline") {
        if (node.note) derived.push({ q: node.text, a: node.note, derived: true });
        if (node.children) walk(node.children);
      }
    }
  };
  walk(body);

  return explicit.length > 0 ? explicit : derived;
}
