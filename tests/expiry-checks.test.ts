import { describe, it, expect } from "vitest";
import {
  waitForExpiry,
  responseClockOffset,
  expiredResponseEvidence,
} from "./hosted/expiry-checks.mjs";

describe("H1 expiry timing and sanitized evidence", () => {
  it("waits beyond the documented 30 seconds instead of checking at exp+5", async () => {
    const expiry = 1000;
    let now = (expiry + 5) * 1000;
    const sleeps: number[] = [];
    // Model PostgREST's documented tolerance, not a real or forged JWT.
    const providerStatus = () => (now <= (expiry + 30) * 1000 ? 200 : 401);
    expect(providerStatus()).toBe(200);
    await waitForExpiry([expiry], {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    expect(now).toBe((expiry + 35) * 1000);
    expect(providerStatus()).toBe(401);
    expect(sleeps).toEqual([30000]);
  });
  it("waits for the last token and reports progress in chunks of at most 30 seconds", async () => {
    let now = 1000000;
    const sleeps: number[] = [];
    let ticks = 0;
    await waitForExpiry([1010, 1040], {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      onWait: () => {
        ticks++;
      },
    });
    expect(now).toBe(1075000);
    expect(sleeps).toEqual([30000, 30000, 15000]);
    expect(ticks).toBe(3);
  });
  it("accounts for the observed server clock without changing the local clock", async () => {
    let now = 1000000;
    await waitForExpiry([1000], {
      now: () => now,
      offsetMs: -10000,
      sleep: async (ms: number) => {
        now += ms;
      },
    });
    expect(now).toBe(1045000);
  });
  it("does not wait again if expiration plus tolerance has already elapsed", async () => {
    await waitForExpiry([1000], {
      now: () => 1100000,
      sleep: async () => {
        throw new Error("Must not sleep");
      },
    });
  });
  it.each([[], [NaN], [Infinity], [0]].map((expiries) => ({ expiries })))(
    "rejects invalid expiration values",
    async ({ expiries }) => {
      await expect(waitForExpiry(expiries, { now: () => 0 })).rejects.toThrow(
        "H1_EXPIRY_INVALID_TIME",
      );
    },
  );
  it("rejects waits beyond the configured limit", async () => {
    await expect(waitForExpiry([10000], { now: () => 0 })).rejects.toThrow(
      "H1_EXPIRY_WAIT_LIMIT",
    );
  });
  it("estimates server offset from HTTP Date and round trip midpoint", () => {
    expect(
      responseClockOffset(new Date(1000000).toUTCString(), 1009000, 1011000),
    ).toBe(-10000);
  });
  it("rejects missing server date and excessive clock difference", () => {
    expect(() => responseClockOffset(null, 0, 0)).toThrow(
      "H1_EXPIRY_CLOCK_UNAVAILABLE",
    );
    expect(() =>
      responseClockOffset(new Date(1000000).toUTCString(), 0, 0),
    ).toThrow("H1_EXPIRY_CLOCK_DIFFERENCE");
  });
  it("keeps only status and fixed reason, never raw provider content", () => {
    const evidence = expiredResponseEvidence({
      status: 401,
      body: {
        message: "JWT expired; PRIVATE_FIXTURE_MARKER",
        details: "PRIVATE_FIXTURE_MARKER",
      },
    });
    expect(evidence).toEqual({ httpStatus: 401, reason: "jwt_expired" });
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE_FIXTURE_MARKER");
  });
  it.each([
    [200, { message: "JWT expired" }, "still_accepted"],
    [401, { message: "Invalid API key" }, "unauthorized_other"],
    [503, { message: "JWT expired" }, "unexpected_status"],
  ])(
    "does not treat HTTP %s as proof of token expiration without matching evidence",
    (status, body, reason) => {
      expect(expiredResponseEvidence({ status, body }).reason).toBe(reason);
    },
  );
});
