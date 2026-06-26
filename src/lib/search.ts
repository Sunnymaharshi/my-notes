/**
 * Search — a custom MiniSearch index built from the note JSON (PLAN §8).
 *
 * One source of truth, two consumers:
 *   - Build (scripts/build-content.ts + tools/dev/content-plugin.ts) calls
 *     `noteToSearchDoc` + `buildSearchIndex` to emit `search-index.json`.
 *   - The browser calls `loadSearchIndex` (lazy, once) then `runSearch`.
 *
 * The index is prebuilt and loaded once; search never walks raw JSON at query time.
 * A note is one document; per-node text is also stored so a hit can deep-link to the
 * matched subtopic (`/python/fastapi#n3.2`) and the note view auto-expands to it.
 */
import MiniSearch, { type Options as MiniSearchOptions } from "minisearch";
import type { BlockNode, Note, NoteMeta } from "./schema.ts";

// ---- node addressing -------------------------------------------------------

/** A node's positional path mirrors BlockRenderer/tree.ts: "1", "1.2", "1.2.0". */
export function nodeAnchorId(path: string): string {
  return `n${path}`;
}

/** Every prefix of a node path, e.g. "0.2.1" -> ["0", "0.2", "0.2.1"]. */
export function ancestorPaths(path: string): string[] {
  const parts = path.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

// ---- per-note document -----------------------------------------------------

export interface SearchNode {
  /** positional path (the node anchor without the "n" prefix) */
  id: string;
  /** searchable text for this node */
  t: string;
}

export interface SearchDoc {
  id: string;
  title: string;
  category: string;
  /** space-joined for tokenization; the array lives in `labels` of stored fields */
  labelsText: string;
  labels: string[];
  summary: string;
  /** concatenated text of normal-weight nodes (outline/callout/table/flashcard/image) */
  content: string;
  /** concatenated code (low weight, separate field) */
  code: string;
  /** per-node text, kept for deep-link target resolution */
  nodes: SearchNode[];
}

/** Searchable plain text for a single node (excluding its children). */
function nodeText(node: BlockNode): string {
  switch (node.type) {
    case "outline":
      return node.note ? `${node.text} ${node.note}` : node.text;
    case "callout":
      return node.text;
    case "table":
      return [...node.headers, ...node.rows.flat()].join(" ");
    case "flashcard":
      return `${node.q} ${node.a}`;
    case "image":
      return node.caption ? `${node.alt} ${node.caption}` : node.alt;
    case "code":
      return node.code;
  }
}

/** Build the search document for a note: walk `body` collecting per-node text + paths. */
export function noteToSearchDoc(note: Note): SearchDoc {
  const nodes: SearchNode[] = [];
  const contentParts: string[] = [];
  const codeParts: string[] = [];

  const walk = (list: BlockNode[], prefix: string) => {
    list.forEach((node, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i);
      const text = nodeText(node).trim();
      if (text) {
        nodes.push({ id: path, t: text });
        (node.type === "code" ? codeParts : contentParts).push(text);
      }
      if (node.type === "outline" && node.children) walk(node.children, path);
    });
  };
  walk(note.body, "");

  return {
    id: note.id,
    title: note.title,
    category: note.category,
    labelsText: note.labels.join(" "),
    labels: note.labels,
    summary: note.summary,
    content: contentParts.join("\n"),
    code: codeParts.join("\n"),
    nodes,
  };
}

// ---- MiniSearch config (shared by build + load) ----------------------------

const FIELDS = ["title", "summary", "labelsText", "category", "content", "code"];
const STORE_FIELDS = ["id", "title", "category", "summary", "labels", "nodes"];

export const miniSearchConfig: MiniSearchOptions = {
  fields: FIELDS,
  storeFields: STORE_FIELDS,
};

/** Query-time options: type-ahead (prefix + fuzzy), weighted by field. */
export const searchQueryOptions = {
  prefix: true,
  fuzzy: 0.2,
  combineWith: "AND" as const,
  boost: { title: 6, summary: 4, labelsText: 3, category: 2, content: 1.5, code: 0.6 },
};

/** Build a MiniSearch index from notes and serialize it (build-time). */
export function buildSearchIndex(notes: Note[]): string {
  const mini = new MiniSearch(miniSearchConfig);
  mini.addAll(notes.map(noteToSearchDoc));
  return JSON.stringify(mini);
}

// ---- client runtime --------------------------------------------------------

export interface SearchHit {
  id: string;
  title: string;
  category: string;
  summary: string;
  labels: string[];
  score: number;
  /** matched node path, if a specific subtopic matched (for deep-linking) */
  nodeId?: string;
  /** short snippet from the matched node (or summary) */
  snippet: string;
}

interface StoredResult {
  id: string;
  title: string;
  category: string;
  summary: string;
  labels: string[];
  nodes: SearchNode[];
  score: number;
  terms: string[];
}

const SNIPPET_MAX = 140;

let loadPromise: Promise<MiniSearch> | null = null;

/** Lazy-load and deserialize the prebuilt index (fetched once, then cached). */
export function loadSearchIndex(base = "/content"): Promise<MiniSearch> {
  loadPromise ??= (async () => {
    const res = await fetch(`${base}/search-index.json`);
    if (!res.ok) throw new Error(`Failed to load search index (${res.status})`);
    return MiniSearch.loadJSON(await res.text(), miniSearchConfig);
  })();
  return loadPromise;
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX - 1)}…` : t;
}

/** Pick the node within a hit whose text best matches the query terms (deep-link target). */
function resolveTarget(r: StoredResult): { nodeId?: string; snippet: string } {
  const terms = r.terms.map((t) => t.toLowerCase());
  let best: { node: SearchNode; hits: number } | null = null;
  for (const node of r.nodes) {
    const lower = node.t.toLowerCase();
    let hits = 0;
    for (const term of terms) if (lower.includes(term)) hits++;
    if (hits > 0 && (!best || hits > best.hits)) best = { node, hits };
  }
  if (best) return { nodeId: best.node.id, snippet: snippet(best.node.t) };
  return { snippet: snippet(r.summary || r.nodes[0]?.t || "") };
}

export interface SearchFacets {
  /** require the hit to carry ALL of these labels */
  labels?: string[];
  /** restrict to a single category */
  category?: string;
}

/** Run a query against the loaded index; returns hits with deep-link targets. */
export async function runSearch(
  query: string,
  facets: SearchFacets = {},
  base = "/content",
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const mini = await loadSearchIndex(base);
  const { labels, category } = facets;

  const results = mini.search(q, {
    ...searchQueryOptions,
    filter: (r) => {
      const sr = r as unknown as StoredResult;
      if (category && sr.category !== category) return false;
      if (labels?.length && !labels.every((l) => sr.labels.includes(l))) return false;
      return true;
    },
  }) as unknown as StoredResult[];

  return results.map((r) => {
    const { nodeId, snippet } = resolveTarget(r);
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      summary: r.summary,
      labels: r.labels,
      score: r.score,
      nodeId,
      snippet,
    };
  });
}

/** Build the deep-link path for a hit (or any note id + optional node path). */
export function noteLink(meta: Pick<NoteMeta, "id" | "category">, nodeId?: string): string {
  const base = `/${meta.category}/${meta.id}`;
  return nodeId ? `${base}#${nodeAnchorId(nodeId)}` : base;
}
