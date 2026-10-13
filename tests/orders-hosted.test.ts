import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ORDERS_PHASES, sanitizeOrdersReport } from "./hosted/orders.mjs";

const runId = "aaaaaaaa-0000-4000-8000-000000000001";
const base = () => ({
  run_id: runId,
  started_at: "2026-10-10T12:00:00.000Z",
  finished_at: "2026-10-10T12:01:00.000Z",
  status: "passed",
  failed_phase: null,
  checks: ORDERS_PHASES.map((name) => ({ name, status: "PASS" })),
  parallel: {
    fulfill_same_key: { successful_responses: 2, same_result: true },
    fulfill_distinct_key: { successful_responses: 1, same_result: false },
    cancel_distinct_key: { successful_responses: 1, same_result: false },
  },
  compensated: true,
  archived: true,
  unresolved_mutation: false,
  token: "must-never-appear",
  customer_phone: "00000000000",
  provider_body: "must-never-appear",
});

describe("Pedidos 007 hosted evidence sanitizer", () => {
  it("exports only fixed phase names, outcomes and bounded race evidence", () => {
    const sanitized = sanitizeOrdersReport(base());
    expect(sanitized.status).toBe("passed");
    expect(sanitized.checks).toHaveLength(ORDERS_PHASES.length);
    expect(sanitized.parallel).toMatchObject({
      fulfill_same_key: { successful_responses: 2, same_result: true },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(
      /must-never-appear|"customer_phone"|"provider_body"|"token"/,
    );
    expect(sanitized.cleanup_retry).toBe("not_run");
  });

  it("refuses a false PASS when a phase, cleanup, or transport is unresolved", () => {
    const candidate = base();
    expect(() =>
      sanitizeOrdersReport({ ...candidate, checks: candidate.checks.slice(1) }),
    ).toThrow();
    expect(() =>
      sanitizeOrdersReport({ ...candidate, archived: false }),
    ).toThrow();
    expect(() =>
      sanitizeOrdersReport({ ...candidate, unresolved_mutation: true }),
    ).toThrow();
    expect(() =>
      sanitizeOrdersReport({
        ...candidate,
        failed_phase: "price_conflict_atomic",
      }),
    ).toThrow();
  });

  it("rejects duplicate or unknown phase and malformed concurrency evidence", () => {
    const candidate = base();
    expect(() =>
      sanitizeOrdersReport({
        ...candidate,
        checks: [...candidate.checks.slice(0, -1), candidate.checks[0]],
      }),
    ).toThrow();
    expect(() =>
      sanitizeOrdersReport({
        ...candidate,
        checks: [{ name: "provider_body", status: "PASS" }],
      }),
    ).toThrow();
    expect(() =>
      sanitizeOrdersReport({
        ...candidate,
        parallel: {
          fulfill_same_key: { successful_responses: 99, same_result: true },
        },
      }),
    ).toThrow();
  });

  it("retains a failed phase without claiming compensation or archive", () => {
    const failed = sanitizeOrdersReport({
      ...base(),
      status: "failed",
      failed_phase: "price_conflict_atomic",
      checks: [{ name: "price_conflict_atomic", status: "FAIL" }],
      compensated: false,
      archived: false,
      unresolved_mutation: true,
    });
    expect(failed).toMatchObject({
      status: "failed",
      failed_phase: "price_conflict_atomic",
      compensated: false,
      archived: false,
      unresolved_mutation: true,
    });
  });
});

it.skipIf(process.platform !== "win32")(
  "keeps migration readable but blocks replacement while FileShare.Read is held",
  () => {
    const directory = resolve("test-results");
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `orders-lock-${randomUUID()}.sql`);
    writeFileSync(path, "select 1;\n", "utf8");
    try {
      const script = `
        $filePath = [Console]::In.ReadToEnd().Trim()
        $hold = [IO.File]::Open($filePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
          $hash = (Get-FileHash -InputStream $hold -Algorithm SHA256).Hash
          $reader = [IO.File]::Open($filePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          $reader.Dispose()
          $blocked = $false
          try {
            $writer = [IO.File]::Open($filePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
            $writer.Dispose()
          } catch [IO.IOException] { $blocked = $true }
          if (-not $blocked) { exit 2 }
          $renamed = $false
          try {
            [IO.File]::Move($filePath, $filePath + '.moved')
            $renamed = $true
          } catch [IO.IOException] { }
          if ($renamed) { exit 4 }
          if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -cne $hash) { exit 3 }
        } finally { $hold.Dispose() }
        $writer = [IO.File]::Open($filePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $writer.Dispose()
      `;
      const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], {
        input: path,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(result.status, result.stderr).toBe(0);
    } finally {
      if (existsSync(path)) unlinkSync(path);
      if (existsSync(`${path}.moved`)) unlinkSync(`${path}.moved`);
    }
  },
);
