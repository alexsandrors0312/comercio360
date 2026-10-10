import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  assessSaleRace,
  sanitizeSalesReport,
  SALES_PHASES,
  settleSalesRequests,
  verifyOwnedSaleItems,
} from "./hosted/sales.mjs";

const id = "10000000-0000-4000-8000-000000000099";
const success = { ok: true, status: 200, id, revision: "1" };
const insufficient = { ok: false, status: 422, code: "PT422" };
describe("hosted PDV evidence and compensation boundaries", () => {
  it("requires one real success and one HTTP422/PT422 for the last item", () => {
    expect(assessSaleRace([success, insufficient])).toEqual({
      successful_responses: 1,
      insufficient_responses: 1,
      same_result: false,
    });
    for (const responses of [
      [success, success],
      [insufficient, insufficient],
      [success, { ...insufficient, status: 500 }],
      [success, { ...insufficient, code: "PT409" }],
    ])
      expect(() => assessSaleRace(responses)).toThrow();
  });
  it("same-key replies must identify the same committed result", () => {
    expect(assessSaleRace([success, { ...success }], true).same_result).toBe(
      true,
    );
    expect(() =>
      assessSaleRace([success, { ...success, revision: "2" }], true),
    ).toThrow();
  });
  it("waits for both concurrent requests after an early rejection", async () => {
    let completed = false;
    const later = new Promise((resolve) =>
      setTimeout(() => {
        completed = true;
        resolve(success);
      }, 10),
    );
    await expect(
      settleSalesRequests([Promise.reject(new Error("private")), later]),
    ).rejects.toThrow("sales probe failed");
    expect(completed).toBe(true);
  });
  it("refuses unknown and mixed sales before any cancellation can run", () => {
    const variants = [{ id, sku: "FICTICIO-A" }];
    const items = new Map([
      [id, [{ variant_id: id, sku: "FICTICIO-A", product_name: "FICTICIO" }]],
    ]);
    expect(() =>
      verifyOwnedSaleItems(
        [{ id }],
        new Set([id]),
        variants,
        items,
        "FICTICIO",
      ),
    ).not.toThrow();
    expect(() =>
      verifyOwnedSaleItems([{ id }], new Set(), variants, items, "FICTICIO"),
    ).toThrow();
    const mixed = new Map([
      [
        id,
        [
          ...items.get(id)!,
          { variant_id: "other", sku: "ALHEIO", product_name: "FICTICIO" },
        ],
      ],
    ]);
    expect(() =>
      verifyOwnedSaleItems(
        [{ id }],
        new Set([id]),
        variants,
        mixed,
        "FICTICIO",
      ),
    ).toThrow();
    expect(() =>
      verifyOwnedSaleItems(
        [{ id }],
        new Set([id]),
        variants,
        new Map([
          [id, [{ variant_id: id, sku: "ALHEIO", product_name: "FICTICIO" }]],
        ]),
        "FICTICIO",
      ),
    ).toThrow();
  });
  it("never declares PASS with missing phases or unfinished compensation", () => {
    const report = {
      run_id: id,
      started_at: "2026-10-10T03:00:00Z",
      finished_at: "2026-10-10T03:01:00Z",
      status: "passed",
      failed_phase: null,
      checks: SALES_PHASES.map((name: string) => ({ name, status: "PASS" })),
      compensated: true,
      archived: true,
      token: "private",
      journal: "private",
    };
    expect(sanitizeSalesReport(report).status).toBe("passed");
    expect(JSON.stringify(sanitizeSalesReport(report))).not.toContain(
      "private",
    );
    expect(() =>
      sanitizeSalesReport({ ...report, compensated: false }),
    ).toThrow();
    expect(() =>
      sanitizeSalesReport({ ...report, checks: report.checks.slice(1) }),
    ).toThrow();
    expect(() =>
      sanitizeSalesReport({ ...report, failed_phase: "private provider body" }),
    ).toThrow();
  });
  it.skipIf(process.platform !== "win32")(
    "PowerShell guard rejects extra migrations, changed SQL and non-dry plans",
    () => {
      // Execute only the real pure guard, extracted with PowerShell's AST. The
      // wrapper's top-level target/credential/network code is never invoked.
      const script = String.raw`
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/sales-hosted.ps1'),[ref]$tokens,[ref]$errors)
if (@($errors).Count -ne 0) { exit 2 }
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-ReviewedMigrationPlan'},$true)
Invoke-Expression $fn.Extent.Text
$hash='a'*64
$cases=@(
 @{plan=@{dryRun=$true;upToDate=$false;migrations=@('202610090003_sales.sql')}; reviewed=$hash;actual=$hash;allow=$true},
 @{plan=@{dryRun=$true;upToDate=$false;migrations=@('202610090003_sales.sql','202610100001_extra.sql')};reviewed=$hash;actual=$hash;allow=$false},
 @{plan=@{dryRun=$true;upToDate=$false;migrations=@('202610090003_sales.sql','999999999999_extra.sql')};reviewed=$hash;actual=$hash;allow=$false},
 @{plan=@{dryRun=$true;upToDate=$false;migrations=@('202610090003_sales.sql')};reviewed=$hash;actual=('b'*64);allow=$false},
 @{plan=@{dryRun=$false;upToDate=$false;migrations=@('202610090003_sales.sql')};reviewed=$hash;actual=$hash;allow=$false},
 @{plan=@{dryRun='true';upToDate=$false;migrations=@('202610090003_sales.sql')};reviewed=$hash;actual=$hash;allow=$false},
 @{plan=@{dryRun=$true;upToDate=$true;migrations=@()};reviewed=$hash;actual=$hash;allow=$false}
)
foreach($case in $cases){$allowed=$false;try{Assert-ReviewedMigrationPlan -Plan $case.plan -ReviewedHash $case.reviewed -ActualHash $case.actual;$allowed=$true}catch{};if($allowed -ne $case.allow){exit 3}}
Write-Output '7 migration guards PASS'
`;
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true, timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("7 migration guards PASS");
    },
  );
});
