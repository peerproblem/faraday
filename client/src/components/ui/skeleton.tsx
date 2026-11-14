import type { ReactNode } from "react";
import { Text } from "@sw3/ui";

/** Stand-in: sw3 v1 has no Skeleton. Decorative, so it is hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" data-fd="skeleton" className={`fd-skeleton${className ? ` ${className}` : ""}`} />;
}

/** Stand-in: sw3 v1 has no empty state. A skeleton while the board is building, a quiet line once it is known to be empty. */
export function Empty({ building, children }: { building: boolean; children: ReactNode }) {
  if (building) return <Skeleton className="h-16" />;
  return (
    <Text size="sm" tone="muted" data-fd="empty">
      {children}
    </Text>
  );
}
