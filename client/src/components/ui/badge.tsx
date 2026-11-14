import type { ComponentProps } from "react";
import { Badge } from "@sw3/ui";

export { Badge };

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

type Props = Omit<ComponentProps<typeof Badge>, "variant"> & { tone: Tone };

/** A Badge chosen by meaning. sw3 v1 has no warning variant, so that one tone is a stand-in. */
export function ToneBadge({ tone, className, ...rest }: Props) {
  if (tone === "warning") {
    return <Badge variant="neutral" data-fd="badge-warning" className={`fd-badge-warning${className ? ` ${className}` : ""}`} {...rest} />;
  }
  return <Badge variant={tone} className={className} {...rest} />;
}
