import { vi } from "vitest";

export const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/point-map", () => ({
  default: ({ points }: { points: unknown[] }) => <div data-testid="map-view">{points.length} points</div>,
}));

// Unovis measures SVG text, which jsdom cannot do. The widgets only need the charts' accessible names here.
// TrendChart is plain SVG and renders for real.
vi.mock("@/components/ui/charts", async (importOriginal) => ({
  TrendChart: (await importOriginal<typeof import("@/components/ui/charts")>()).TrendChart,
  BarList: (await importOriginal<typeof import("@/components/ui/charts")>()).BarList,
  DonutChart: (props: { "aria-label"?: string }) => <div role="img" aria-label={props["aria-label"]} />,
  LineChart: (props: { "aria-label"?: string }) => <div role="img" aria-label={props["aria-label"]} data-testid="line-chart" />,
  Sparkline: () => <svg aria-hidden="true" data-testid="sparkline" />,
  ChartCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
