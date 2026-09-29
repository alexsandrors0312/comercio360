import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  validateSeedTarget,
  assertFictionalAccounts,
} from "../scripts/seed-guard.mjs";
const env = {
  ALLOW_DEVELOPMENT_SEED: "yes",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-a.supabase.co",
  CONFIRM_SUPABASE_PROJECT_URL: "https://project-a.supabase.co",
  SUPABASE_SECRET_KEY: "fixture-only-not-a-real-key",
  SEED_PASSWORD: "fixture-only-password",
};
describe("seed preflight", () => {
  it("accepts an independently confirmed project origin, including trailing slash", () => {
    expect(
      validateSeedTarget({
        ...env,
        CONFIRM_SUPABASE_PROJECT_URL: env.NEXT_PUBLIC_SUPABASE_URL + "/",
      }).url,
    ).toBe(env.NEXT_PUBLIC_SUPABASE_URL);
  });
  it.each([
    "",
    "https://project-b.supabase.co",
    "http://project-a.supabase.co",
  ])("rejects missing or different confirmation %s", (confirmation) => {
    expect(() =>
      validateSeedTarget({
        ...env,
        CONFIRM_SUPABASE_PROJECT_URL: confirmation,
      }),
    ).toThrow();
  });
  it.each([
    "https://user:password@project-a.supabase.co",
    "https://project-a.supabase.co/path",
    "https://project-a.supabase.co?target=b",
    "https://project-a.supabase.co#fragment",
  ])("rejects ambiguous or credential-bearing destination", (url) => {
    expect(() =>
      validateSeedTarget({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: url,
        CONFIRM_SUPABASE_PROJECT_URL: url,
      }),
    ).toThrow();
  });
  it("still requires the development flag and secret inputs", () => {
    expect(() =>
      validateSeedTarget({ ...env, ALLOW_DEVELOPMENT_SEED: "no" }),
    ).toThrow();
    expect(() =>
      validateSeedTarget({ ...env, SUPABASE_SECRET_KEY: "" }),
    ).toThrow();
    expect(() =>
      validateSeedTarget({ ...env, SEED_PASSWORD: "short" }),
    ).toThrow();
  });
  it("permits explicit local development while comparing ports", () => {
    expect(
      validateSeedTarget({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        CONFIRM_SUPABASE_PROJECT_URL: "http://127.0.0.1:54321",
      }).url,
    ).toBe("http://127.0.0.1:54321");
    expect(() =>
      validateSeedTarget({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        CONFIRM_SUPABASE_PROJECT_URL: "http://127.0.0.1:54322",
      }),
    ).toThrow();
  });
  it("validates every fictional account, not just the first item", () => {
    expect(() =>
      assertFictionalAccounts([
        { email: "one@example.test" },
        { email: "two@example.test" },
      ]),
    ).not.toThrow();
    for (const email of [
      "real@example.com",
      "x@example.test.evil",
      "x@other.example.test",
      "x@example.test\n",
      "x@evil@example.test",
    ])
      expect(() =>
        assertFictionalAccounts([{ email: "one@example.test" }, { email }]),
      ).toThrow();
  });
  it.each(["missing", "different"])(
    "CLI makes zero HTTP requests with %s confirmation",
    async (mode) => {
      let requests = 0;
      const server = createServer((_request, response) => {
        requests++;
        response.writeHead(500);
        response.end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
      try {
        const destination = `http://127.0.0.1:${address.port}`;
        const result = await new Promise<{
          code: number | null;
          output: string;
        }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              fileURLToPath(
                new URL("../scripts/seed-users.mjs", import.meta.url),
              ),
            ],
            {
              env: {
                ...process.env,
                ...env,
                NEXT_PUBLIC_SUPABASE_URL: destination,
                CONFIRM_SUPABASE_PROJECT_URL:
                  mode === "missing" ? "" : "http://localhost:1",
              },
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            },
          );
          let output = "";
          child.stdout.on("data", (chunk) => (output += chunk));
          child.stderr.on("data", (chunk) => (output += chunk));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, output }));
        });
        expect(result.code).not.toBe(0);
        expect(requests).toBe(0);
        expect(result.output).not.toContain(env.SUPABASE_SECRET_KEY);
        expect(result.output).not.toContain(env.SEED_PASSWORD);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
