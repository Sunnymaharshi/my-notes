import { useEffect, useState } from "react";
import type { Category, Domain, NoteMeta } from "./schema.ts";
import { fetchCategories, fetchDomains, fetchNoteIndex } from "./content.ts";

export interface ContentIndex {
  index: NoteMeta[];
  categories: Category[];
  domains: Domain[];
  loading: boolean;
  error: string | null;
}

// Shared metadata index + categories + domains (fetches are memoized in content.ts).
export function useContent(): ContentIndex {
  const [state, setState] = useState<ContentIndex>({
    index: [],
    categories: [],
    domains: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchNoteIndex(), fetchCategories(), fetchDomains()])
      .then(([index, categories, domains]) => {
        if (!cancelled) setState({ index, categories, domains, loading: false, error: null });
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

export function domainLabel(domains: Domain[], id: string): string {
  return domains.find((d) => d.id === id)?.label ?? id;
}

/** The domain id a category belongs to (for grouping categories under domains). */
export function categoryDomain(categories: Category[], id: string): string | undefined {
  return categories.find((c) => c.id === id)?.domain;
}
