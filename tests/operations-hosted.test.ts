import { describe, expect, it } from "vitest";
// The hosted module exports only pure evidence helpers on import, without I/O.
import { assessParallelReceipts, sanitizeOperationsReport, runBrowserSupplierSteps, classifySupplierNotice, classifySupplierPostStatus } from "./hosted/operations.mjs";

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
  it("keeps only fixed supplier substep evidence and rejects arbitrary diagnostics", () => {
    const report = sanitizeOperationsReport({ ...failed(), failed_phase: "browser_supplier", failed_substep: "heading", browser_supplier_steps: [{ name: "page_status", status: "PASS" }, { name: "heading", status: "FAIL", error: "private payload" }], browser_supplier_page: { http_200: true, route_compras: false, route_login: true, access_denied: false, unavailable: false, url: "private URL" } });
    expect(report.failed_substep).toBe("heading");
    expect(JSON.stringify(report)).not.toContain("private payload");
    expect(JSON.stringify(report)).not.toContain("private URL");
    expect(report.browser_supplier_page.route_login).toBe(true);
    expect(() => sanitizeOperationsReport({ ...failed(), failed_substep: "private provider body" })).toThrow("operations probe failed");
    expect(() => sanitizeOperationsReport({ ...failed(), browser_supplier_steps: [{ name: "cookie value", status: "FAIL" }] })).toThrow("operations probe failed");
  });
  it("records the exact failing substep before propagating a sanitized error", async () => {
    const entries: Array<{ name: string; status: string }> = [];
    const invoked: string[] = [];
    const names = ["page_status", "heading", "store", "open", "fields", "submit", "rpc", "cookies"];
    const operations = Object.fromEntries(names.map((name) => [name, async () => { invoked.push(name); if (name === "store") throw new Error("private cookie or provider body"); }]));
    await expect(runBrowserSupplierSteps(operations, (entry: { name: string; status: string }) => entries.push(entry))).rejects.toThrow("operations probe failed");
    expect(invoked).toEqual(["page_status", "heading", "store"]);
    expect(entries).toEqual([{ name: "page_status", status: "PASS" }, { name: "heading", status: "PASS" }, { name: "store", status: "FAIL" }]);
  });
  it("classifies UI notices and POST status without emitting arbitrary text", () => {
    expect(classifySupplierNotice("Confira o fornecedor, os itens, as quantidades e os custos informados.")).toBe("invalid");
    expect(classifySupplierNotice("Fornecedor salvo.")).toBe("success");
    expect(classifySupplierNotice("Não foi possível confirmar a operação.")).toBe("unavailable");
    expect(classifySupplierNotice("private response", true)).toBe("ambiguous");
    expect(classifySupplierNotice("private cookie/token/provider payload")).toBe("none");
    expect(classifySupplierPostStatus(500)).toBe("500");
    expect(classifySupplierPostStatus(200)).toBe("200");
    expect(classifySupplierPostStatus("private body")).toBe("other");
    const report = sanitizeOperationsReport({ ...failed(), browser_supplier_submit: { notice: "invalid", notice_present: true, post_observed: true, post_http_status: "200", screenshot_saved: true, response: "private payload", path: "private path" } });
    expect(JSON.stringify(report)).not.toContain("private payload");
    expect(JSON.stringify(report)).not.toContain("private path");
    expect(() => sanitizeOperationsReport({ ...failed(), browser_supplier_submit: { notice: "private message" } })).toThrow("operations probe failed");
  });
});
