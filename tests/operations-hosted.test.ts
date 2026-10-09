import { describe, expect, it } from "vitest";
// The hosted module exports only pure evidence helpers on import, without I/O.
import { assessParallelReceipts, sanitizeOperationsReport } from "./hosted/operations.mjs";

const id = "10000000-0000-4000-8000-000000000099";
const success = { ok: true, status: 200, id, revision: "2" };
const conflict = { ok: false, status: 409, code: "PT409" };
describe("hosted operation concurrency evidence", () => {
  it("requires exactly one success and one real HTTP409/PT409 for distinct keys", () => {
    expect(assessParallelReceipts([success, conflict], false)).toEqual({ successful_responses: 1, conflicts: 1, same_result: false });
    for (const responses of [[success, success], [conflict, conflict], [success, { ...conflict, status: 500 }], [success, { ...conflict, code: "40001" }], [success]]) {
      expect(() => assessParallelReceipts(responses, false)).toThrow("operations probe failed");
    }
  });
  it("identical-key replay requires both successful responses to match ID and revision", () => {
    expect(assessParallelReceipts([success, { ...success }], true).same_result).toBe(true);
    for (const changed of [{ ...success, revision: "3" }, { ...success, id: "20000000-0000-4000-8000-000000000099" }, conflict, { ...success, status: 202 }]) {
      expect(() => assessParallelReceipts([success, changed], true)).toThrow("operations probe failed");
    }
  });
});
describe("hosted operation report privacy and completion", () => {
  const failed = () => ({ run_id: id, started_at: "2026-10-09T17:00:00.000Z", finished_at: "2026-10-09T17:01:00.000Z", status: "failed", failed_phase: "browser_receive", checks: [{ name: "browser_receive", status: "FAIL", provider: "private" }], compensated: true, archived: true, secret: "never export", cookies: "never export", fixture_ids: ["never export"] });
  it("returns only allowlisted fields, preserving failure and pending cleanup gate", () => {
    const report = sanitizeOperationsReport(failed());
    expect(report.status).toBe("failed");
    expect(report.failed_phase).toBe("browser_receive");
    expect(report.cleanup_retry).toBe("not_run");
    expect(JSON.stringify(report)).not.toMatch(/never export|provider|cookies|fixture_ids|secret/);
  });
  it("cannot mark PASS without every stage and verified compensation/archive", () => {
    expect(() => sanitizeOperationsReport({ ...failed(), status: "passed", failed_phase: null })).toThrow("operations probe failed");
    expect(() => sanitizeOperationsReport({ ...failed(), failed_phase: "secret from provider" })).toThrow("operations probe failed");
    expect(() => sanitizeOperationsReport({ ...failed(), checks: [{ name: "unknown", status: "PASS" }] })).toThrow("operations probe failed");
  });
});
