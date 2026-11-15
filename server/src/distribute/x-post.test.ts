import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthHeader, pct, postToX, xCreds } from "./x-post";

// The worked example in X's "Creating a signature" guide.
const creds = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("posting to X", () => {
  it("signs a request exactly like X's documented example", () => {
    const header = oauthHeader("POST", "https://api.twitter.com/1.1/statuses/update.json", creds,
      { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
    expect(header).toContain(`oauth_signature="${pct("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).not.toContain(creds.consumerSecret);
    expect(header).not.toContain(creds.tokenSecret);
  });

  it("needs all four account credentials", () => {
    expect(xCreds({ X_API_CONSUMER_KEY: "a", X_API_SECRET_KEY: "b", X_API_ACCESS_TOKEN: "c" })).toBeNull();
    expect(xCreds({ X_API_CONSUMER_KEY: "a", X_API_SECRET_KEY: "b", X_API_ACCESS_TOKEN: "c", X_API_ACCESS_SECRET: "d" }))
      .toEqual({ consumerKey: "a", consumerSecret: "b", token: "c", tokenSecret: "d" });
  });

  it("sends the text as JSON once and returns the post id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { id: "1900000000000000009", text: "hi" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await postToX("hi", creds)).toBe("1900000000000000009");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi" });
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^OAuth oauth_consumer_key=/);
  });

  it("reports a refused post without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response('{"title":"Forbidden"}', { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postToX("hi", creds)).rejects.toThrow("X post HTTP 403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
