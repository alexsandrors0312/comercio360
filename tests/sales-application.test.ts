import { beforeEach, describe, expect, it, vi } from "vitest";
const org = "10000000-0000-4000-8000-000000000001",
  store = "10000000-0000-4000-8000-000000000011",
  variant = "10000000-0000-4000-8000-000000000301",
  user = "a0000000-0000-4000-8000-000000000001",
  id = "10000000-0000-4000-8000-000000000901";
const state = vi.hoisted(() => ({
  role: "manager" as string | null,
  storeAllowed: true,
  active: true,
  signedIn: true,
  configured: true,
  providerError: false,
  rpcError: null as string | null,
  throwRpc: false,
  response: null as unknown,
  responses: [] as unknown[],
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  revalidated: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (v: string) => state.revalidated.push(v),
}));
vi.mock("../lib/supabase/server", () => ({
  isConfigured: () => state.configured,
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.signedIn ? { id: user } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      return {
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return this;
        },
        async maybeSingle() {
          const valid =
            filters.organization_id === org && filters.active === true;
          return {
            data:
              table === "memberships"
                ? valid &&
                  filters.user_id === user &&
                  state.active &&
                  state.role
                  ? { role: state.role }
                  : null
                : valid && filters.id === store && state.storeAllowed
                  ? { id: store }
                  : null,
            error: state.providerError ? { message: "private" } : null,
          };
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (state.throwRpc) throw new Error("private infrastructure");
      return {
        data: state.responses.length ? state.responses.shift() : state.response,
        error: state.rpcError
          ? { code: state.rpcError, message: "private provider details" }
          : null,
      };
    },
  }),
}));
import {
  authorizeSales,
  getSalesPermissions,
  listSaleVariants,
  listSales,
  getSale,
} from "../lib/sales/server";
import {
  confirmSale,
  cancelSale,
  findSaleVariants,
} from "../app/actions/sales";
const scope = { organizationId: org, storeId: store };
const input = {
  items: [{ variantId: variant, quantity: "3", expectedUnitPriceCents: 1234 }],
  idempotencyKey: id,
};
const cancel = {
  saleId: id,
  expectedRevision: "1",
  reason: "  Retorno integral fictício  ",
  idempotencyKey: variant,
};
beforeEach(() => {
  Object.assign(state, {
    role: "manager",
    storeAllowed: true,
    active: true,
    signedIn: true,
    configured: true,
    providerError: false,
    rpcError: null,
    throwRpc: false,
    response: [{ id, revision: "1" }],
  });
  state.responses.length = 0;
  state.calls.length = 0;
  state.revalidated.length = 0;
});
describe("PDV live authorization and mutation contracts", () => {
  it.each(["owner", "manager", "cashier"])(
    "%s confirms prices in cents and refreshes inventory",
    async (role) => {
      state.role = role;
      expect((await confirmSale(scope, input)).status).toBe("success");
      expect(state.calls[0]).toEqual({
        name: "sales_confirm",
        args: {
          p_organization_id: org,
          p_store_id: store,
          p_items: [
            {
              variant_id: variant,
              quantity: 3,
              expected_unit_price_cents: 1234,
            },
          ],
          p_idempotency_key: id,
        },
      });
      expect(state.revalidated).toEqual(["/app/pdv", "/app/estoque"]);
      expect(await getSalesPermissions(scope)).toEqual({
        canConfirm: true,
        canCancel: role !== "cashier",
        userId: user,
      });
    },
  );
  it.each(["owner", "manager"])(
    "%s cancels with CAS and sanitized reason",
    async (role) => {
      state.role = role;
      expect((await cancelSale(scope, cancel)).status).toBe("success");
      expect(state.calls[0]).toEqual({
        name: "sales_cancel",
        args: {
          p_organization_id: org,
          p_store_id: store,
          p_sale_id: id,
          p_expected_revision: "1",
          p_reason: "Retorno integral fictício",
          p_idempotency_key: variant,
        },
      });
    },
  );
  it("cashier cannot cancel even with crafted input", async () => {
    state.role = "cashier";
    expect((await cancelSale(scope, cancel)).status).toBe("denied");
    expect(state.calls).toHaveLength(0);
  });
  it.each(["buyer", "stockist", "driver", "marketing", "finance"])(
    "%s cannot read or confirm",
    async (role) => {
      state.role = role;
      await expect(authorizeSales(scope)).rejects.toMatchObject({
        kind: "denied",
      });
      expect((await confirmSale(scope, input)).status).toBe("denied");
      expect((await findSaleVariants(scope, "CAM")).status).toBe("denied");
      expect(state.calls).toHaveLength(0);
    },
  );
  it("reauthorizes replay after session, membership, store and role revocation", async () => {
    await confirmSale(scope, input);
    for (const flag of ["signedIn", "active", "storeAllowed"] as const) {
      state[flag] = false;
      expect((await confirmSale(scope, input)).status).toBe("denied");
      state[flag] = true;
    }
    state.role = "stockist";
    expect((await confirmSale(scope, input)).status).toBe("denied");
    expect(state.calls).toHaveLength(1);
  });
  it("rejects foreign scope, malformed, duplicate and missing-price inputs", async () => {
    for (const foreign of [
      { ...scope, organizationId: id },
      { ...scope, storeId: id },
      { ...scope, storeId: "bad" },
    ])
      expect((await confirmSale(foreign, input)).status).toMatch(
        /denied|invalid/,
      );
    for (const value of [
      { ...input, items: [] },
      { ...input, items: [...input.items, ...input.items] },
      {
        ...input,
        items: [{ ...input.items[0], expectedUnitPriceCents: null }],
      },
      { ...input, items: [{ ...input.items[0], quantity: "1e2" }] },
      { ...input, idempotencyKey: "bad" },
    ])
      expect((await confirmSale(scope, value as typeof input)).status).toBe(
        "invalid",
      );
    expect(state.calls).toHaveLength(0);
  });
  it("allows zero price and normalizes UUID and ordering without accepting client actor", async () => {
    const other = "AAAAAAAA-0000-4000-8000-000000000001";
    await confirmSale(scope, {
      ...input,
      items: [
        { variantId: other, quantity: " 1 ", expectedUnitPriceCents: 0 },
        ...input.items,
      ],
    });
    expect(state.calls[0].args.p_items).toEqual([
      { variant_id: variant, quantity: 3, expected_unit_price_cents: 1234 },
      {
        variant_id: other.toLowerCase(),
        quantity: 1,
        expected_unit_price_cents: 0,
      },
    ]);
    expect(state.calls[0].args).not.toHaveProperty("p_actor_user_id");
  });
  it.each([
    ["42501", "denied"],
    ["PT409", "conflict"],
    ["PT422", "insufficient"],
    ["22023", "invalid"],
    ["23514", "invalid"],
    ["40001", "unavailable"],
    ["PGRST202", "unavailable"],
  ])("sanitizes %s to %s", async (code, status) => {
    state.rpcError = code;
    const result = await confirmSale(scope, input);
    expect(result.status).toBe(status);
    expect(result.message).not.toContain("private");
    expect(state.revalidated).toHaveLength(0);
  });
  it("treats malformed or lost results as ambiguous", async () => {
    state.throwRpc = true;
    expect((await confirmSale(scope, input)).status).toBe("unavailable");
    state.throwRpc = false;
    for (const result of [
      null,
      [],
      [{ id: "bad", revision: "1" }],
      [{ id, revision: "0" }],
      [{ id, revision: "9223372036854775808" }],
    ]) {
      state.response = result;
      expect((await confirmSale(scope, input)).status).toBe("unavailable");
    }
    state.providerError = true;
    expect((await confirmSale(scope, input)).status).toBe("unavailable");
    expect(state.revalidated).toHaveLength(0);
  });
});
describe("PDV scoped wire reads", () => {
  const sale = {
    id,
    status: "confirmed",
    revision: "1",
    total_cents: "3702",
    created_at: "2026-10-09T12:00:00Z",
    cancelled_at: null,
    cancellation_reason: null,
    total_count: "1",
  };
  const variantRow = {
    variant_id: variant,
    product_name: "Camiseta",
    sku: "CAM-P",
    color: null,
    size: null,
    quantity: "3",
    unit_price_cents: "1234",
    total_count: "1",
  };
  it("reads nullable and zero prices distinctly, without purchase costs", async () => {
    state.response = [{ ...variantRow, unit_price_cents: null }];
    expect((await listSaleVariants(scope)).items[0].unitPriceCents).toBeNull();
    state.response = [{ ...variantRow, unit_price_cents: "0" }];
    const result = await findSaleVariants(scope, " CAM ");
    expect(result).toMatchObject({
      status: "success",
      items: [{ unitPriceCents: 0 }],
    });
    expect(state.calls[1]).toMatchObject({
      name: "sales_variants",
      args: { p_query: "CAM", p_organization_id: org, p_store_id: store },
    });
    expect(JSON.stringify(result)).not.toContain("cost");
  });
  it("keeps stable pagination totals on an empty out-of-range page", async () => {
    state.responses.push([], [sale]);
    expect(
      await listSales(scope, { query: " CAM ", page: 2, pageSize: 10 }),
    ).toMatchObject({ page: 2, total: 1, items: [] });
    expect(state.calls[0].args).toMatchObject({ p_query: "CAM", p_offset: 10 });
    expect(state.calls[1].args.p_offset).toBe(0);
  });
  it("returns immutable snapshots rather than current catalog price", async () => {
    state.responses.push(
      [sale],
      [
        {
          variant_id: variant,
          product_name: "Camiseta snapshot",
          sku: "CAM-P",
          quantity: "3",
          unit_price_cents: "1234",
        },
      ],
    );
    expect(await getSale(scope, id)).toMatchObject({
      sale: { totalCents: 3702 },
      items: [
        { productName: "Camiseta snapshot", quantity: 3, unitPriceCents: 1234 },
      ],
    });
    expect(state.calls[1]).toMatchObject({
      name: "sales_items",
      args: { p_sale_id: id, p_organization_id: org, p_store_id: store },
    });
  });
  it("refuses mismatched selectors, overflow and invalid provider values", async () => {
    state.response = [{ ...sale, id: variant }];
    await expect(getSale(scope, id)).rejects.toMatchObject({
      kind: "unavailable",
    });
    state.response = [{ ...sale, total_cents: "1000000000001" }];
    await expect(listSales(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    state.response = [{ ...variantRow, unit_price_cents: "1.23" }];
    await expect(listSaleVariants(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(getSale(scope, "bad")).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  it("separates denied, invalid input and provider unavailability on reads", async () => {
    state.rpcError = "42501";
    await expect(listSales(scope)).rejects.toMatchObject({ kind: "denied" });
    state.rpcError = "PGRST202";
    await expect(listSales(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect((await findSaleVariants(scope, "x".repeat(201))).status).toBe(
      "invalid",
    );
    state.configured = false;
    await expect(listSaleVariants(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
