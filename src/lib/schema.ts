import { z } from "zod";

/**
 * Single source of truth for the content model.
 *
 * A note is a structured JSON block-tree: `body` is an array of typed block nodes.
 * The same tree renders as the collapsible tree view (default), and later as
 * doc / flashcard views. New capability = new node `type` here + a renderer + an
 * editor control. Never break existing node types.
 *
 * Validated at build (scripts/build-content.ts), on admin save, and on import.
 */

// ---- Block nodes -----------------------------------------------------------

export const CalloutVariant = z.enum(["tip", "warning", "info", "note", "gotcha"]);
export type CalloutVariant = z.infer<typeof CalloutVariant>;

// `outline` is recursive (children can be any block node), so its schema is
// defined via z.lazy and the BlockNode union is typed explicitly.
export interface OutlineNode {
  type: "outline";
  text: string;
  note?: string;
  children?: BlockNode[];
}

export interface CodeNode {
  type: "code";
  lang: string;
  code: string;
  filename?: string;
  highlight?: number[];
  /** Pre-rendered highlighted HTML, injected server-side at build/dev. Not in source. */
  codeHtml?: string;
}

export interface ImageNode {
  type: "image";
  src: string;
  alt: string;
  caption?: string;
}

export interface CalloutNode {
  type: "callout";
  variant: CalloutVariant;
  text: string;
}

export interface TableNode {
  type: "table";
  headers: string[];
  rows: string[][];
}

export interface FlashcardNode {
  type: "flashcard";
  q: string;
  a: string;
}

export type BlockNode =
  | OutlineNode
  | CodeNode
  | ImageNode
  | CalloutNode
  | TableNode
  | FlashcardNode;

// Defined as plain ZodObjects so they can be used as discriminatedUnion options.
export const CodeNodeSchema = z.object({
  type: z.literal("code"),
  lang: z.string().min(1),
  code: z.string(),
  filename: z.string().optional(),
  highlight: z.array(z.number().int().nonnegative()).optional(),
});

export const ImageNodeSchema = z.object({
  type: z.literal("image"),
  src: z.string().min(1),
  alt: z.string(),
  caption: z.string().optional(),
});

export const CalloutNodeSchema = z.object({
  type: z.literal("callout"),
  variant: CalloutVariant,
  text: z.string().min(1),
});

export const TableNodeSchema = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())),
});

export const FlashcardNodeSchema = z.object({
  type: z.literal("flashcard"),
  q: z.string().min(1),
  a: z.string().min(1),
});

// `outline` is recursive: children may be any block node. z.lazy breaks the cycle.
export const BlockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("outline"),
      text: z.string().min(1),
      note: z.string().optional(),
      children: z.array(BlockNodeSchema).optional(),
    }),
    CodeNodeSchema,
    ImageNodeSchema,
    CalloutNodeSchema,
    TableNodeSchema,
    FlashcardNodeSchema,
  ]),
) as z.ZodType<BlockNode>;

// ---- Note envelope ---------------------------------------------------------

export const Difficulty = z.enum(["beginner", "intermediate", "advanced"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const NoteSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "id must be kebab-case (a-z, 0-9, -)"),
  title: z.string().min(1),
  category: z.string().min(1),
  labels: z.array(z.string().min(1)).default([]),
  summary: z.string().default(""),
  difficulty: Difficulty.optional(),
  related: z.array(z.string()).optional(),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be YYYY-MM-DD"),
  draft: z.boolean().default(false),
  body: z.array(BlockNodeSchema),
});

export type Note = z.infer<typeof NoteSchema>;

// Slim metadata index entry (the `body` is intentionally omitted).
export type NoteMeta = Pick<
  Note,
  "id" | "title" | "category" | "labels" | "summary" | "difficulty" | "updated"
> & { draft?: boolean };

export const CategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().int().default(0),
});

export type Category = z.infer<typeof CategorySchema>;
