"use client";

import { forwardRef, type CSSProperties } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

type BoardHeaderButtonProps = Omit<
  ButtonProps, "children" | "variant" | "size" | "leading" | "trailing" | "iconOnly" | "fullWidth"
> & { icon: IconName; "aria-label": string };

export const BoardHeaderButton = forwardRef<HTMLButtonElement, BoardHeaderButtonProps>(
  function BoardHeaderButton({ icon, style, ...props }, ref) {
    const active = props["aria-pressed"] === true || props["aria-expanded"] === true;
    const colors = {
      color: "var(--sw-foreground)",
      "--sw-button-secondary-bg": active
        ? "var(--sw-selection)"
        : "var(--sw-muted)",
    } as CSSProperties;

    return (
      <Button
        {...props}
        ref={ref}
        size="sm"
        variant="secondary"
        iconOnly
        leading={<Icon name={icon} width={16} height={16} />}
        style={{ ...style, ...colors }}
      />
    );
  },
);
