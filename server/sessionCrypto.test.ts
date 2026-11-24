import { describe, expect, it } from "vitest";
import { safeEqual, sealSession, signDeskToken, unsealSession } from "./sessionCrypto";

describe("sessionCrypto (stateless Cloud Run Kite cookies & desk PIN)", () => {
  it("encrypts and decrypts a Kite session payload cleanly", () => {
    const payload = {
      accessToken: "sample-token-123",
      userId: "AB1234",
      userName: "Trader",
      obtainedAt: "2026-11-24T04:00:00.000Z",
    };
    const sealed = sealSession(payload, "my-strong-secret");
    expect(sealed).not.toContain("sample-token-123");
    const restored = unsealSession<typeof payload>(sealed, "my-strong-secret");
    expect(restored).toEqual(payload);
  });

  it("rejects tampered tokens or wrong secrets", () => {
    const sealed = sealSession({ accessToken: "abc" }, "secret-1");
    expect(unsealSession(sealed, "wrong-secret")).toBeNull();
    const parts = sealed.split(".");
    parts[2] = `${parts[2].slice(0, -2)}AA`;
    expect(unsealSession(parts.join("."), "secret-1")).toBeNull();
  });

  it("signs and verifies desk PIN tokens in constant time", () => {
    const token = signDeskToken("998877", "server-secret");
    const same = signDeskToken("998877", "server-secret");
    const other = signDeskToken("112233", "server-secret");
    expect(safeEqual(token, same)).toBe(true);
    expect(safeEqual(token, other)).toBe(false);
  });
});
