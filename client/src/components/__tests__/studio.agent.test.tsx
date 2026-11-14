import "./jsdom-stubs";
import { push } from "./mocks";
import { render, screen } from "@testing-library/react";
import { createAgent } from "@/components/ui/agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFixture } from "../../../e2e/fixtures";
import { confirmStep } from "@/components/board/agent-bridge";
import { Studio } from "@/components/studio";

let approve = false;
const agent = createAgent({ confirm: (req) => confirmStep(req, () => approve) });
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true, tier: "paused" }), { status: 200 }));

beforeEach(() => {
  approve = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const fx = () => getFixture("flood")!;
const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));
/** The Tabs root and its tab list share the name "Studio panels"; the root is the one that switches panels. */
const panelsRef = () => agent.snapshot().find((e) => e.component === "tabs" && e.label === "Studio panels")!.ref;
const openManage = () => agent.act({ steps: [{ ref: panelsRef(), action: "setValue", args: ["Manage"] }] });

test("every control in the studio has a name an agent can find", () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit offline />);
  const components = agent.snapshot().filter((e) => !e.offPage && e.component !== "more");
  for (const entry of components) expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
  const labels = components.map((e) => e.label);
  for (const label of ["Studio panels", "Edit the program", "Recompile the board", "Road closures pages"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }
  // The sort headers of the Road closures table sit in a Resizable panel and are still found.
  expect(components.some((e) => e.component === "button" && /^Road\b/.test(e.label)), "the Road sort header is missing").toBe(true);
});

test("the app marks the controls that change or delete a board, and only those", async () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit offline />);
  const marked = () =>
    agent
      .snapshot()
      .filter((e) => e.requiresConfirmation)
      .map((e) => e.label);
  expect(marked()).toEqual(["Recompile the board"]);
  const open = await openManage();
  expect(open.ok, open.error?.message).toBe(true);
  await vi.waitFor(() => expect(marked()).toContain("Delete board"));
  expect(agent.snapshot().find((e) => e.label === "Pause live updates")?.requiresConfirmation).toBeFalsy();
});

test("an agent can write an edit, but recompiling waits for the person", async () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit offline />);
  const fill = await agent.act({ steps: [{ ref: "Edit the program", action: "setValue", args: ["Add a table of shelters"] }] });
  expect(fill.ok, fill.error?.message).toBe(true);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Edit the program").value).toBe("Add a table of shelters");

  const recompile = { steps: [{ ref: "Recompile the board", action: "press" as const }] };
  expect((await agent.act(recompile)).ok).toBe(false);
  expect(calls("/edit")).toHaveLength(0);
  approve = true;
  const r = await agent.act(recompile);
  expect(r.ok, r.error?.message).toBe(true);
  expect(calls("/edit")).toHaveLength(1);
  expect(JSON.parse(String(calls("/edit")[0][1]?.body))).toEqual({ instruction: "Add a table of shelters" });
});

test("an agent can pause, change visibility and delete only with the person's yes", async () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit offline />);
  const open = await openManage();
  expect(open.ok, open.error?.message).toBe(true);

  const pause = await agent.act({ steps: [{ ref: "Pause live updates", action: "press" }] });
  expect(pause.ok, pause.error?.message).toBe(true);
  expect(calls("/pause")).toHaveLength(1);

  const vis = await agent.act({ steps: [{ ref: "Board visibility", action: "setValue", args: ["Unlisted"] }] });
  expect(vis.ok, vis.error?.message).toBe(true);
  expect(JSON.parse(String(calls("/visibility")[0][1]?.body))).toEqual({ visibility: "unlisted" });

  const remove = {
    steps: [
      { ref: "Delete board", action: "open" as const },
      { ref: "Delete forever", action: "press" as const },
    ],
  };
  expect((await agent.act(remove)).ok).toBe(false);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  approve = true;
  const r = await agent.act(remove);
  expect(r.ok, r.error?.message).toBe(true);
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1));
  await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/"));
});

test("people who do not own the board get no edit form or manage tab", () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit={false} offline />);
  expect(screen.queryByLabelText("Edit the program")).toBeNull();
  expect(screen.queryByRole("tab", { name: "Manage" })).toBeNull();
  expect(screen.getByText("Only admins can edit the shared board. Everyone can shape their own dashboard.")).toBeTruthy();
});

test("the pipeline waterfall lists the run's steps with times", () => {
  render(<Studio initial={fx().board} initialRun={fx().run} canEdit offline />);
  expect(screen.getByRole("treegrid", { name: "Pipeline steps of the latest run" })).toBeTruthy();
  expect(screen.getByText("Extract facts 1")).toBeTruthy();
  expect(screen.getByText("41.2s")).toBeTruthy();
});
