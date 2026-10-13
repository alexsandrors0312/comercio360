import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({ sales: vi.fn(), orders: vi.fn(), stock: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/sales/server", () => ({ listSales: readers.sales }));
vi.mock("../lib/orders/server", () => ({ listOrders: readers.orders }));
vi.mock("../lib/inventory/server", () => ({ listInventoryStock: readers.stock }));
import { getOperationsOverview, getOperationsReport } from "../lib/operations/server";
import { operationsReportSchema } from "../packages/validation/operations";

const scope = { organizationId: "10000000-0000-4000-8000-000000000001", storeId: "10000000-0000-4000-8000-000000000011" };
const page = { items: [], page: 1, pageSize: 20, total: 47 };
beforeEach(() => {
  vi.resetAllMocks();
  for (const reader of Object.values(readers)) reader.mockResolvedValue(page);
});

describe("Operational consultations through authorized source readers", () => {
  it("keeps the source total beyond a page and scopes every commercial consultation", async () => {
    const result = await getOperationsOverview(scope, true);
    expect(result.sales).toEqual({ status: "ready", data: page });
    expect(readers.sales).toHaveBeenCalledWith(scope, { status: "confirmed", pageSize: 5 });
    expect(readers.orders).toHaveBeenCalledWith(scope, { status: "open", pageSize: 1 });
    expect(readers.stock).toHaveBeenCalledWith(scope, { pageSize: 1 });
  });
  it("never asks commercial readers for the stock-only presentation", async () => {
    const result = await getOperationsOverview(scope, false);
    expect(result.sales.status).toBe("hidden");
    expect(result.orders.status).toBe("hidden");
    expect(readers.sales).not.toHaveBeenCalled();
    expect(readers.orders).not.toHaveBeenCalled();
    expect(result.stock.status).toBe("ready");
  });
  it("does not replace failed or revoked reads with zero or provider details", async () => {
    readers.sales.mockRejectedValue(Object.assign(new Error("private-provider-data"), { kind: "denied" }));
    readers.stock.mockRejectedValue(new Error("secret-provider-data"));
    const result = await getOperationsOverview(scope, true);
    expect(result.sales).toEqual({ status: "unavailable" });
    expect(result.stock).toEqual({ status: "unavailable" });
    expect(result.orders.status).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("provider-data");
  });
  it("passes sale status and pagination, without applying product search to sales", async () => {
    expect(await getOperationsReport(scope, { type: "sales", status: "cancelled", page: "2", query: "SKU" }))
      .toEqual({ type: "sales", page });
    expect(readers.sales).toHaveBeenCalledWith(scope, { status: "cancelled", page: 2, pageSize: 20 });
    expect(readers.stock).not.toHaveBeenCalled();
  });
  it("passes normalized inventory filter and leaves commercial readers unused", async () => {
    await getOperationsReport(scope, { type: "stock", query: " SKU-42 ", page: 2 });
    expect(readers.stock).toHaveBeenCalledWith(scope, { query: "SKU-42", page: 2, pageSize: 20 });
    expect(readers.sales).not.toHaveBeenCalled();
  });
  it("rejects malformed filters before consulting sources", async () => {
    for (const input of [{ page: 0 }, { page: "1.5" }, { page: "1e9" }, { type: "costs" }, { status: "paid" }, { query: "a".repeat(201) }, { query: "a\u0000" }]) {
      await expect(getOperationsReport(scope, input)).rejects.toMatchObject({ kind: "invalid" });
    }
    expect(readers.sales).not.toHaveBeenCalled();
    expect(readers.stock).not.toHaveBeenCalled();
  });
  it("keeps source access denial for forged selection even when report type is explicit", async () => {
    readers.sales.mockRejectedValue(Object.assign(new Error("details-must-not-escape"), { kind: "denied" }));
    await expect(getOperationsReport(scope, { type: "sales" })).rejects.toMatchObject({ kind: "denied" });
    await expect(getOperationsReport(scope, { type: "sales" })).rejects.not.toThrow("details-must-not-escape");
  });
  it("validates maximum page and normalizes default filters", () => {
    expect(operationsReportSchema.parse({ type: "stock", page: "100000" })).toEqual({ type: "stock", status: "all", query: "", page: 100000 });
  });
});
