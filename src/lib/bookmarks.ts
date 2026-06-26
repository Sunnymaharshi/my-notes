import { useSyncExternalStore } from "react";

/**
 * Bookmarked note ids, persisted to localStorage. A tiny external store keeps every
 * subscriber (sidebar list, note-header star) in sync, including across browser tabs.
 */
const KEY = "bookmarks";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let ids: string[] = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Reflect changes made in other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      ids = load();
      emit();
    }
  });
}

export function toggleBookmark(id: string): void {
  ids = ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids];
  persist();
  emit();
}

/** Reactive list of bookmarked note ids (most-recently-added first). */
export function useBookmarks(): string[] {
  return useSyncExternalStore(subscribe, () => ids, () => ids);
}

/** Reactive boolean for a single note. */
export function useIsBookmarked(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ids.includes(id),
    () => false,
  );
}
