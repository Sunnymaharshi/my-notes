import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

// The initial theme is applied before paint by the inline bootstrap in index.html
// (reads localStorage, else the system preference). This hook just reflects/toggles it.
function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        // ignore (private mode / disabled storage)
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
