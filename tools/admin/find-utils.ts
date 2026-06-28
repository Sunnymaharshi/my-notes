/** Shared find-bar types and the CSS Custom Highlight API clear helper. */

export type FindMatch = { term: string; idx: number };

/** Clear all gen-find highlights from the CSS Custom Highlight registry.
 *  Uses window.CSS explicitly (avoids any Vite module-scope CSS shadowing)
 *  and .clear() rather than .delete() — more reliable across browsers. */
export function clearGenHighlights() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.CSS as any).highlights?.clear();
  } catch (_) {}
}
