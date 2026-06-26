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
    case "text":
      return node.text;
    case "table":
      return [...node.headers, ...node.rows.flat()].join(" ");
    case "flashcard":
      return `${node.q} ${node.a}`;
    case "image":
      return node.caption ? `${node.alt} ${node.caption}` : node.alt;
    case "code":
      return node.code;
    case "link":
      return node.text ? `${node.text} ${node.url}` : node.url;
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

/** Query-time options: type-ahead (prefix + fuzzy), weighted by field.
 *  `combineWith` is set per-query by `runSearch` (AND first, OR fallback). */
export const searchQueryOptions = {
  prefix: true,
  fuzzy: 0.2,
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

interface NodeMatch {
  node: SearchNode;
  /** how many distinct query terms appear in this node's text */
  hits: number;
  /** tree depth (1 = top level); shallower = more section-like */
  depth: number;
}

/** Every node in a hit whose text contains a query term, ranked by specificity:
 *  more term hits first, then shallower depth (section headings over leaf details).
 *  A note can yield several matching subtopics — each becomes its own search result. */
function matchingNodes(r: StoredResult): NodeMatch[] {
  const terms = r.terms.map((t) => t.toLowerCase());
  const matches: NodeMatch[] = [];
  for (const node of r.nodes) {
    const lower = node.t.toLowerCase();
    let hits = 0;
    for (const term of terms) if (lower.includes(term)) hits++;
    if (hits === 0) continue;
    matches.push({ node, hits, depth: node.id.split(".").length });
  }
  matches.sort((a, b) => b.hits - a.hits || a.depth - b.depth);
  return matches;
}

/** At most this many subtopic hits per note, and overall, so a broad query never floods. */
const PER_NOTE_MAX = 6;
const TOTAL_MAX = 40;

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

  const filter = (r: unknown) => {
    const sr = r as StoredResult;
    if (category && sr.category !== category) return false;
    if (labels?.length && !labels.every((l) => sr.labels.includes(l))) return false;
    return true;
  };
  const search = (combineWith: "AND" | "OR") =>
    mini.search(q, { ...searchQueryOptions, combineWith, filter }) as unknown as StoredResult[];

  // Prefer all-terms matches (precise); fall back to any-term so a single typo or an
  // extra word never drops the hit entirely (e.g. "redis script" -> "redis lua scripts").
  let results = search("AND");
  if (results.length === 0) results = search("OR");

  // Expand each note into one result per matching subtopic (deep-linkable), so a single
  // note surfaces several relevant landing spots rather than collapsing to one. Results
  // are ranked by node specificity within a note, then by the note's own relevance.
  const hits: SearchHit[] = [];
  for (const r of results) {
    const base = {
      id: r.id,
      title: r.title,
      category: r.category,
      summary: r.summary,
      labels: r.labels,
    };
    const matches = matchingNodes(r);
    if (matches.length === 0) {
      hits.push({ ...base, score: r.score, snippet: snippet(r.summary || r.nodes[0]?.t || "") });
      continue;
    }
    matches.slice(0, PER_NOTE_MAX).forEach((m, i) => {
      hits.push({
        ...base,
        // Boost multi-term nodes; the tiny `i` term preserves the within-note specificity order.
        score: r.score * (1 + m.hits) - i * 1e-3,
        nodeId: m.node.id,
        snippet: snippet(m.node.t),
      });
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, TOTAL_MAX);
}

/** Build the deep-link path for a hit (or any note id + optional node path). */
export function noteLink(meta: Pick<NoteMeta, "id" | "category">, nodeId?: string): string {
  const base = `/${meta.category}/${meta.id}`;
  return nodeId ? `${base}#${nodeAnchorId(nodeId)}` : base;
}
