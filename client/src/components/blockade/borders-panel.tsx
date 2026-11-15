"use client";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Meter } from "@/components/ui/meter";
import { EmptyState } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { SourceChips } from "@/components/widgets/source-chips";
import { when } from "@/lib/time";
import { crossingStateLabel, stateLevel, type Crossing, type CrossingState, type NeighborBorder } from "./blockade-data";
import { PanelSection, type BlockadeContext } from "./widget";

const stateTone: Record<CrossingState, BadgeVariant> = {
  closed: "danger", restricted: "warning", pending: "warning", open: "success", unknown: "neutral",
};

function Report({ crossing, context, named }: { crossing: Crossing; context: BlockadeContext; named?: boolean }) {
  return (
    <li>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Text size="sm" className="min-w-0 font-medium">{named ? crossing.name : "Border as a whole"}</Text>
        <Badge variant={stateTone[crossing.state]} className="shrink-0">{crossing.status || crossingStateLabel[crossing.state]}</Badge>
      </div>
      {crossing.note && <Text size="sm" tone="subtle">{crossing.note}</Text>}
      <div className="flex flex-wrap items-center gap-2">
        {crossing.asOf && (
          <Text as="span" size="sm" tone="muted" className="tabular-nums">
            <time dateTime={crossing.asOf}>{when(crossing.asOf)}</time>
          </Text>
        )}
        <SourceChips ids={crossing.sources} sources={context.sources} evidence={crossing.evidence} />
      </div>
    </li>
  );
}

export function BordersPanel({ context, borders }: { context: BlockadeContext; borders: NeighborBorder[] }) {
  if (!borders.length) {
    return <EmptyState title="No border reports yet" description="The sources have not reported on Iran's land crossings." />;
  }
  const named = borders.reduce((sum, border) => sum + border.crossings.length, 0);
  return (
    <>
      <PanelSection title="How shut each border is" aside={`${named} named ${named === 1 ? "crossing" : "crossings"}`}>
        <div className="grid gap-3">
          {borders.map((border) => (
            <Meter key={border.neighbor} size="sm" label={border.neighbor} showValue={false}
              value={stateLevel(border.state) + 1} min={0} max={4} low={1.5} high={3.5} optimum={0}
              getValueLabel={() => crossingStateLabel[border.state]}
              className="fd-blockade-border-meter" data-reading={crossingStateLabel[border.state]} />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
          <span>Open</span>
          <span>Restricted</span>
          <span>Closed</span>
        </div>
      </PanelSection>

      {borders.map((border) => (
        <Card key={border.neighbor} role="region" aria-label={`${border.neighbor} border`} padding="sm" radius="lg" className="fd-blockade-border">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="min-w-0 text-sm font-semibold">{border.neighbor}</h3>
            <Text as="span" size="sm" tone="muted">
              {border.crossings.length ? `${border.crossings.length} named ${border.crossings.length === 1 ? "crossing" : "crossings"}` : "Border-wide reports"}
            </Text>
          </div>
          <ul className="fd-blockade-records" aria-label={`${border.neighbor} border reports`}>
            {border.overall.map((crossing) => <Report key={crossing.id} crossing={crossing} context={context} />)}
            {border.crossings.map((crossing) => <Report key={crossing.id} crossing={crossing} context={context} named />)}
          </ul>
        </Card>
      ))}
    </>
  );
}
