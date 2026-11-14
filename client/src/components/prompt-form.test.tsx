import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@/components/ui/agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PromptForm } from "./prompt-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const agent = createAgent();
const PROMPT = "Wildfire near Athens: which areas are evacuating?";

test("the build button stays disabled until the prompt has 8 characters", async () => {
  const user = userEvent.setup();
  render(<PromptForm signedIn />);
  const build = screen.getByRole("button", { name: "Build the board" });
  expect((build as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText("Describe the crisis"), "Flood");
  expect((build as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText("Describe the crisis"), " in Valencia");
  expect((build as HTMLButtonElement).disabled).toBe(false);
});

test("an example button fills the prompt", async () => {
  const user = userEvent.setup();
  render(<PromptForm signedIn />);
  await user.click(screen.getByRole("button", { name: "Kyiv blackouts after strikes on the power grid" }));
  expect(screen.getByLabelText<HTMLTextAreaElement>("Describe the crisis").value).toMatch(/^Kyiv blackouts/);
});

test("signed out, submitting goes to sign in instead of calling the engine", async () => {
  const user = userEvent.setup();
  render(<PromptForm signedIn={false} />);
  await user.type(screen.getByLabelText("Describe the crisis"), PROMPT);
  await user.click(screen.getByRole("button", { name: "Build the board" }));
  expect(push).toHaveBeenCalledWith("/login?next=/");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("signed in, submitting posts the prompt and opens the studio", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "b123", slug: "athens" }), { status: 200 }));
  const user = userEvent.setup();
  render(<PromptForm signedIn />);
  await user.type(screen.getByLabelText("Describe the crisis"), PROMPT);
  await user.click(screen.getByRole("button", { name: "Build the board" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/api\/boards$/);
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("include");
  expect(JSON.parse(String(init.body))).toEqual({ prompt: PROMPT });
  expect(push).toHaveBeenCalledWith("/studio/b123");
});

test("Cmd+Enter submits, and an engine error shows on the field", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Try again a bit later." }), { status: 429 }));
  const user = userEvent.setup();
  render(<PromptForm signedIn />);
  const box = screen.getByLabelText("Describe the crisis");
  await user.type(box, PROMPT);
  await act(async () => {
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Try again a bit later.")).toBeTruthy();
  expect(push).not.toHaveBeenCalled();
});

test("an agent can find the prompt, fill it and build", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "b9", slug: "x" }), { status: 200 }));
  render(<PromptForm signedIn />);
  const components = agent.snapshot().filter((e) => !e.offPage && e.component !== "more");
  for (const e of components) expect(e.label, `${e.component} ${e.ref} has no name`).toBeTruthy();
  const labels = components.map((e) => e.label);
  for (const label of ["Describe the crisis", "Build the board"]) expect(labels).toContain(label);
  const result = await agent.act({
    steps: [
      { ref: "Describe the crisis", action: "setValue", args: [PROMPT] },
      { ref: "Build the board", action: "press", args: [] },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith("/studio/b9");
});
