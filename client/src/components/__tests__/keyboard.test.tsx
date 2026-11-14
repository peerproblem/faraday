import "./jsdom-stubs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { confirmStep } from "@/components/board/agent-bridge";
import { createAgent } from "@/components/ui/agent";
import { Demos } from "@/app/dev/ui/demos";

// The sw3 v2 parts Faraday relies on, driven from the keyboard and by an agent, as a person or assistant would.

test("a sortable table header sorts from the keyboard", async () => {
  const user = userEvent.setup();
  render(<Demos />);
  const table = screen.getByRole("table", { name: "Road closures" });
  const roads = () => within(table).getAllByRole("rowheader").map((c) => c.textContent);
  expect(roads()).toEqual(["GA-400 northbound", "I-85 at exit 113", "US-19 near Dahlonega"]);
  const sort = within(table).getByRole("button", { name: /Since/ });
  sort.focus();
  await user.keyboard("{Enter}");
  const first = roads();
  await user.keyboard("{Enter}");
  expect(roads()).toEqual([...first].reverse());
});

test("a citation chip opens with Enter and closes with Escape", async () => {
  const user = userEvent.setup();
  render(<Demos />);
  const chip = screen.getByRole("button", { name: /s3/ });
  chip.focus();
  await user.keyboard("{Enter}");
  expect(chip.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("link", { name: /Open source/ }).getAttribute("href")).toBe("https://example.org/evacuation-update");
  await user.keyboard("{Escape}");
  expect(chip.getAttribute("aria-expanded")).toBe("false");
});

test("arrow keys move between tabs", async () => {
  const user = userEvent.setup();
  render(<Demos />);
  const filters = screen.getByRole("tab", { name: "Filters" });
  filters.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Danger zone" })).toBe(document.activeElement);
});

test("the agent sees a segmented control inside a tab panel and changes it", async () => {
  render(<Demos />);
  const agent = createAgent({ confirm: () => false });
  expect(agent.snapshot().some((c) => c.component === "segmented-control" && c.label === "Scope")).toBe(true);
  const r = await agent.act({ steps: [{ ref: "Scope", action: "setValue", args: ["official"] }] });
  expect(r.ok, r.error?.message).toBe(true);
  expect(screen.getByRole("radio", { name: "Official" }).getAttribute("aria-checked")).toBe("true");
});

test("a marked action needs the person's yes", async () => {
  const user = userEvent.setup();
  render(<Demos />);
  await user.click(screen.getByRole("tab", { name: "Danger zone" }));
  const ask = vi.fn(() => false);
  const refuse = createAgent({ confirm: (req) => confirmStep(req, ask) });
  const marked = refuse.snapshot().find((c) => c.label === "Delete forever");
  expect(marked?.requiresConfirmation).toBe(true);
  expect((await refuse.act({ steps: [{ ref: "Delete forever", action: "press" }] })).ok).toBe(false);
  expect(ask).toHaveBeenCalledOnce();
  const allow = createAgent({ confirm: (req) => confirmStep(req, () => true) });
  expect((await allow.act({ steps: [{ ref: "Delete forever", action: "press" }] })).ok).toBe(true);
});
