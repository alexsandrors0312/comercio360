import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const orgs = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000001",
];
const stores = [
  "10000000-0000-4000-8000-000000000011",
  "10000000-0000-4000-8000-000000000012",
  "20000000-0000-4000-8000-000000000011",
];
const markerKey = "fixture-only-not-a-key";
const markerPassword = "fixture-only-not-a-password";

describe("seed sanitized diagnostics with loopback API only", () => {
  it.each([
    ["missing-confirmation", 22, 0],
    ["different-confirmation", 23, 0],
    ["missing-key", 24, 0],
    ["short-password", 25, 0],
    ["missing-sql-seed", 57, 0],
    ["denied-key", 61, 0],
    ["missing-schema", 53, 0],
    ["auth-list-denied", 61, 0],
    ["weak-password", 76, 1],
    ["profile-fk", 84, 2],
    ["existing-users", 0, 11],
  ] as const)(
    "%s has a safe code and respects the write boundary",
    async (scenario, exitCode, expectedWrites) => {
      let requests = 0,
        writes = 0;
      const server = createServer((request, response) => {
        requests++;
        if (request.method !== "GET") writes++;
        request.resume();
        response.setHeader("Content-Type", "application/json");
        response.setHeader("X-Supabase-Api-Version", "2024-01-01");
        const fail = (status: number, code: string) => {
          response.statusCode = status;
          response.end(
            JSON.stringify({ code, message: `${markerKey} ${markerPassword}` }),
          );
        };
        if (scenario === "denied-key") return fail(403, "42501");
        if (
          scenario === "missing-schema" &&
          request.url?.startsWith("/rest/v1/")
        )
          return fail(404, "PGRST205");
        if (request.url?.startsWith("/rest/v1/organizations"))
          return response.end(
            JSON.stringify(
              scenario === "missing-sql-seed" ? [] : orgs.map((id) => ({ id })),
            ),
          );
        if (request.url?.startsWith("/rest/v1/stores"))
          return response.end(JSON.stringify(stores.map((id) => ({ id }))));
        if (
          request.url?.startsWith("/auth/v1/admin/users") &&
          request.method === "GET"
        ) {
          if (scenario === "auth-list-denied") return fail(401, "bad_jwt");
          const users =
            scenario === "existing-users"
              ? [
                  "gerente.aurora",
                  "caixa.aurora",
                  "gerente.horizonte",
                  "sem.vinculo",
                ].map((name, index) => ({
                  id: `a0000000-0000-4000-8000-00000000000${index + 1}`,
                  email: `${name}@example.test`,
                }))
              : [];
          return response.end(JSON.stringify({ users }));
        }
        if (
          request.url === "/auth/v1/admin/users" &&
          request.method === "POST"
        ) {
          if (scenario === "existing-users")
            return fail(400, "fixture_must_preserve_existing_users");
          if (scenario === "weak-password") return fail(422, "weak_password");
          return response.end(
            JSON.stringify({ id: "a0000000-0000-4000-8000-000000000001" }),
          );
        }
        if (request.url?.startsWith("/rest/v1/profiles")) {
          if (scenario === "profile-fk") return fail(409, "23503");
          return response.end("null");
        }
        if (request.url?.startsWith("/rest/v1/memberships"))
          return response.end(
            JSON.stringify({ id: "b0000000-0000-4000-8000-000000000001" }),
          );
        if (request.url?.startsWith("/rest/v1/user_store_access"))
          return response.end("null");
        return fail(500, "fixture_unexpected_path");
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("No fixture address");
        const origin = `http://127.0.0.1:${address.port}`;
        const env = {
          ...process.env,
          NODE_OPTIONS: "",
          NEXT_PUBLIC_SUPABASE_URL: origin,
          CONFIRM_SUPABASE_PROJECT_URL:
            scenario === "missing-confirmation"
              ? ""
              : scenario === "different-confirmation"
                ? "http://localhost:1"
                : origin,
          ALLOW_DEVELOPMENT_SEED: "yes",
          SUPABASE_SECRET_KEY: scenario === "missing-key" ? "" : markerKey,
          SEED_PASSWORD:
            scenario === "short-password" ? "short" : markerPassword,
        };
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
            { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "";
          child.stdout.on("data", (chunk) => (output += chunk));
          child.stderr.on("data", (chunk) => (output += chunk));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, output }));
        });
        expect(result.code).toBe(exitCode);
        if (exitCode !== 0)
          expect(result.output.trim()).toBe(`H1-SEED-${exitCode}`);
        else
          expect(result.output).toContain("Existing passwords are preserved.");
        expect(result.output).not.toContain(markerKey);
        expect(result.output).not.toContain(markerPassword);
        expect(writes).toBe(expectedWrites);
        if (exitCode > 0 && exitCode < 30) expect(requests).toBe(0);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
