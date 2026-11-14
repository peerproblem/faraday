import { encode } from "@auth/core/jwt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCookies, sessionUserId } from "./session";

const SECRET = "test-auth-secret-0123456789abcdef";
const NAME = "authjs.session-token";

const token = (uid: string, salt = NAME) => encode({ token: { uid }, secret: SECRET, salt });

describe("session cookie", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  it("keeps a malformed value as it is instead of throwing", () => {
    expect(() => parseCookies("a=100%; b=%E0%A4%A")).not.toThrow();
    expect(parseCookies("a=100%; b=x%20y").get("a")).toBe("100%");
    expect(parseCookies("a=100%; b=x%20y").get("b")).toBe("x y");
  });

  it("reads a session next to a malformed unrelated cookie", async () => {
    const t = await token("u1");
    await expect(sessionUserId(`other=100%; ${NAME}=${t}; junk=%E0%A4%A`)).resolves.toBe("u1");
  });

  it("reads a chunked session cookie", async () => {
    const t = await token("u2");
    const mid = Math.floor(t.length / 2);
    await expect(sessionUserId(`bad=%; ${NAME}.0=${t.slice(0, mid)}; ${NAME}.1=${t.slice(mid)}`)).resolves.toBe("u2");
  });

  it("answers null, never throws, for garbage headers", async () => {
    await expect(sessionUserId("%%%; =; ;;; a=%")).resolves.toBeNull();
    await expect(sessionUserId(`${NAME}=%E0%A4%A`)).resolves.toBeNull();
    await expect(sessionUserId(undefined)).resolves.toBeNull();
  });
});
