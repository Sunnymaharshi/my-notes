/** Thin client for the admin API (tools/admin/server.ts). */
import type { BlockNode, Category, Domain, Note, NoteMeta } from "../../src/lib/schema.ts";
import type { DupeGroup } from "../../src/lib/dupes.ts";
import type { ZodIssue } from "zod";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export class ApiError extends Error {
  status: number;
  issues?: ZodIssue[];
  constructor(status: number, data: any) {
    super(data?.error ?? `Request failed (${status})`);
    this.status = status;
    this.issues = data?.issues;
  }
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  categories: () => req<Category[]>("/api/categories"),
  saveCategories: (cats: Category[], renames?: Record<string, string>) =>
    req<Category[]>("/api/categories", jsonInit("PUT", { categories: cats, renames })),
  domains: () => req<Domain[]>("/api/domains"),
  saveDomains: (doms: Domain[]) => req<Domain[]>("/api/domains", jsonInit("PUT", doms)),
  notes: () => req<NoteMeta[]>("/api/notes"),
  note: (id: string) => req<Note>(`/api/notes/${id}`),
  create: (input: { id?: string; title: string; category: string }) =>
    req<Note>("/api/notes", jsonInit("POST", input)),
  save: (id: string, note: Note) => req<Note>(`/api/notes/${id}`, jsonInit("PUT", note)),
  remove: (id: string) => req<{ ok: true }>(`/api/notes/${id}`, jsonInit("DELETE", {})),
  upload: (id: string, filename: string, dataBase64: string) =>
    req<{ src: string }>(`/api/notes/${id}/assets`, jsonInit("POST", { filename, dataBase64 })),
  import: (text: string, ext: string) =>
    req<{ body: BlockNode[] }>("/api/import", jsonInit("POST", { text, ext })),
  dupes: () => req<DupeGroup[]>("/api/dupes"),
};
