import { useCallback, useState } from "react";

export type Density = "comfortable" | "compact";

// The initial density is applied before paint by the inline bootstrap in
// index.html (reads localStorage, defaults to comfortable). This hook just
// reflects/toggles it. Comfortable = airy reading; compact = dense revision.
function current(): Density {
  return document.documentElement.dataset.density === "compact" ? "compact" : "comfortable";
}

export function useDensity(): { density: Density; toggle: () => void } {
  const [density, setDensity] = useState<Density>(current);

  const toggle = useCallback(() => {
    setDensity((prev) => {
      const next: Density = prev === "comfortable" ? "compact" : "comfortable";
      document.documentElement.dataset.density = next;
      try {
        localStorage.setItem("density", next);
      } catch {
        // ignore (private mode / disabled storage)
      }
      return next;
    });
  }, []);

  return { density, toggle };
}
