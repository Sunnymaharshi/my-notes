import type { Category, Domain, Note, NoteMeta } from "./schema.ts";

// Content is served as static JSON from /content (dev: live from source; prod: generated).
const BASE = "/content";

let indexPromise: Promise<NoteMeta[]> | null = null;
let categoriesPromise: Promise<Category[]> | null = null;
let domainsPromise: Promise<Domain[]> | null = null;
const noteCache = new Map<string, Promise<Note>>();

async function getJSON<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${what} (${res.status})`);
  return res.json();
}

export function fetchNoteIndex(): Promise<NoteMeta[]> {
  indexPromise ??= getJSON<NoteMeta[]>(`${BASE}/index.json`, "note index");
  return indexPromise;
}

export function fetchCategories(): Promise<Category[]> {
  categoriesPromise ??= getJSON<Category[]>(`${BASE}/categories.json`, "categories");
  return categoriesPromise;
}

export function fetchDomains(): Promise<Domain[]> {
  domainsPromise ??= getJSON<Domain[]>(`${BASE}/domains.json`, "domains");
  return domainsPromise;
}

export function fetchNote(id: string): Promise<Note> {
  let p = noteCache.get(id);
  if (!p) {
    p = getJSON<Note>(`${BASE}/notes/${id}/index.json`, `note "${id}"`);
    noteCache.set(id, p);
  }
  return p;
}

/** Resolve a note-relative image src (e.g. "./diagram.png") to its served URL. */
export function resolveAsset(noteId: string, src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith("/")) return src;
  return `${BASE}/notes/${noteId}/${src.replace(/^\.\//, "")}`;
}
