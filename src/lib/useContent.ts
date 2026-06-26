import { useEffect, useState } from "react";
import type { Category, NoteMeta } from "./schema.ts";
import { fetchCategories, fetchNoteIndex } from "./content.ts";

export interface ContentIndex {
  index: NoteMeta[];
  categories: Category[];
  loading: boolean;
  error: string | null;
}

// Shared metadata index + categories (fetches are memoized in content.ts).
export function useContent(): ContentIndex {
  const [state, setState] = useState<ContentIndex>({
    index: [],
    categories: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchNoteIndex(), fetchCategories()])
      .then(([index, categories]) => {
        if (!cancelled) setState({ index, categories, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled)
          setState((s) => ({ ...s, loading: false, error: String(err.message ?? err) }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function categoryLabel(categories: Category[], id: string): string {
  return categories.find((c) => c.id === id)?.label ?? id;
}
