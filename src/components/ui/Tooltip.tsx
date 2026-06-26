import * as RT from "@radix-ui/react-tooltip";
import styles from "./Tooltip.module.css";

/**
 * Thin wrapper over Radix Tooltip with the Field Manual styling. Wrap any
 * trigger (typically an icon button) to give it an accessible, delayed label.
 * Requires a <Tooltip.Provider> near the app root (see main.tsx).
 */
export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content className={styles.content} side={side} sideOffset={6}>
          {label}
          <RT.Arrow className={styles.arrow} />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}

export const TooltipProvider = RT.Provider;
