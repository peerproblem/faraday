"use client";

import { Meter } from "@/components/ui/meter";

/** Crisis severity on a 0 to 5 scale. A client component, so server pages can render it without passing functions. */
export function SeverityMeter({ value }: { value: number }) {
  return (
    <Meter
      label="Severity"
      value={Math.min(5, Math.max(0, value))}
      min={0}
      max={5}
      low={2}
      high={4}
      optimum={0}
      size="sm"
      formatOptions={{ style: "decimal", maximumFractionDigits: 1 }}
      getValueLabel={(v) => `${v} of 5`}
    />
  );
}
