import { APICallError } from "ai";
import { Experimental_DecisionMockModelV4 as DecisionMock } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDecisionFactoryForTest, activeBackend, decide, type Question } from "./decide";

const questions = {
  onTopic: { type: "boolean", instructions: "On topic?" },
  kind: { type: "choice", instructions: "Kind?", criteria: { news: "News", official: "Official" } },
  severity: { type: "score", instructions: "Severity?", criteria: ["Low", "High"] },
} satisfies Record<string, Question>;

const goodAnswers = {
  onTopic: { type: "boolean" as const, probability: 0.8 },
  kind: { type: "choice" as const, choice: "news" },
  severity: { type: "score" as const, score: 0.7, probabilities: { "0": 0.3, "1": 0.7 } },
};

function model(name: string, doDecide: () => Promise<unknown>) {
  return new DecisionMock({ provider: name, modelId: `${name}-model`, supportedQuestionTypes: ["boolean", "choice", "score"], doDecide: doDecide as never });
}

const ok = () => Promise.resolve({ answers: goodAnswers, usage: { inputTokens: 12 }, warnings: [] });
const httpError = (status: number) =>
  new APICallError({ message: `status ${status}`, url: "https://x", requestBodyValues: {}, statusCode: status, isRetryable: false });

describe("decide", () => {
  const savedBackend = process.env.DECISION_BACKEND;
  beforeEach(() => {
    delete process.env.DECISION_BACKEND;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    __setDecisionFactoryForTest(null);
    process.env.DECISION_BACKEND = savedBackend;
    vi.restoreAllMocks();
  });

  it("normalizes answers and fills a missing choice distribution", async () => {
    __setDecisionFactoryForTest((b) => ({ model: model(b, ok), modelId: `${b}-model` }));
    const r = await decide({ text: "x" }, questions);
    expect(r.backend).toBe("google");
    expect(r.model).toBe("google-model");
    expect(r.tokensIn).toBe(12);
    expect(r.answers.onTopic).toEqual({ type: "boolean", probability: 0.8 });
    expect(r.answers.kind).toEqual({ type: "choice", choice: "news", probabilities: { news: 1 } });
    expect(r.answers.severity).toEqual({ type: "score", score: 0.7, probabilities: { "0": 0.3, "1": 0.7 } });
  });

  it("uses openai when DECISION_BACKEND=openai", async () => {
    process.env.DECISION_BACKEND = "openai";
    const google = vi.fn(ok);
    __setDecisionFactoryForTest((b) => ({ model: model(b, b === "google" ? google : ok), modelId: `${b}-model` }));
    const r = await decide("state", questions);
    expect(r.backend).toBe("openai");
    expect(google).not.toHaveBeenCalled();
  });

  it("falls back to openai on a google auth error and stays there", async () => {
    const google = vi.fn(() => Promise.reject(httpError(403)));
    __setDecisionFactoryForTest((b) => ({ model: model(b, b === "google" ? google : ok), modelId: `${b}-model` }));
    expect((await decide("s", questions)).backend).toBe("openai");
    expect(activeBackend()).toBe("openai");
    expect((await decide("s", questions)).backend).toBe("openai");
    expect(google).toHaveBeenCalledTimes(1);
  });

  it("rethrows a single 5xx and falls back after three in a row", async () => {
    const google = vi.fn(() => Promise.reject(httpError(503)));
    __setDecisionFactoryForTest((b) => ({ model: model(b, b === "google" ? google : ok), modelId: `${b}-model` }));
    await expect(decide("s", questions)).rejects.toThrow();
    await expect(decide("s", questions)).rejects.toThrow();
    expect((await decide("s", questions)).backend).toBe("openai");
  });

  it("resets the 5xx count after a success", async () => {
    let n = 0;
    const google = vi.fn(() => (++n === 3 ? ok() : Promise.reject(httpError(500))));
    __setDecisionFactoryForTest((b) => ({ model: model(b, b === "google" ? google : ok), modelId: `${b}-model` }));
    await expect(decide("s", questions)).rejects.toThrow();
    await expect(decide("s", questions)).rejects.toThrow();
    expect((await decide("s", questions)).backend).toBe("google");
    await expect(decide("s", questions)).rejects.toThrow();
    expect(activeBackend()).toBe("google");
  });

  it("does not fall back on a 400 that is not about access", async () => {
    const google = vi.fn(() => Promise.reject(httpError(400)));
    __setDecisionFactoryForTest((b) => ({ model: model(b, b === "google" ? google : ok), modelId: `${b}-model` }));
    await expect(decide("s", questions)).rejects.toThrow();
    expect(activeBackend()).toBe("google");
  });

  it("rejects an answer of the wrong type", async () => {
    const bad = () => Promise.resolve({ answers: { ...goodAnswers, onTopic: { type: "choice", choice: "yes" } }, warnings: [] });
    __setDecisionFactoryForTest((b) => ({ model: model(b, bad), modelId: `${b}-model` }));
    await expect(decide("s", questions)).rejects.toThrow();
  });
});
