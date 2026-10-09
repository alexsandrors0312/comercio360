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
            error: null,
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
  authorizeProcurement,
  listProcurementSuppliers,
  listPurchaseOrders,
  getPurchaseOrder,
} from "../lib/procurement/server";
import {
  saveProcurementSupplier,
  createPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  findPurchaseVariants,
} from "../app/actions/procurement";
const scope = { organizationId: org, storeId: store };
const supplierInput = {
  supplierId: id,
  name: "  Ateliê do Fornecedor  ",
  contact: "  Contato fictício  ",
  active: true,
  expectedRevision: "0",
  idempotencyKey: id,
};
const purchaseInput = {
  supplierId: id,
  items: [{ variantId: variant, quantity: "3", unitCost: "12,34" }],
  idempotencyKey: id,
};
const transition = { orderId: id, expectedRevision: "1", idempotencyKey: id };
beforeEach(() => {
  Object.assign(state, {
    role: "manager",
    storeAllowed: true,
    active: true,
    signedIn: true,
    configured: true,
    rpcError: null,
    throwRpc: false,
    response: [{ id, revision: "1" }],
  });
  state.responses.length = 0;
  state.calls.length = 0;
  state.revalidated.length = 0;
});
describe("Procurement live authorization and RPC boundaries", () => {
  it.each(["owner", "manager", "buyer"])(
    "%s manages purchases and suppliers",
    async (role) => {
      state.role = role;
      expect((await saveProcurementSupplier(scope, supplierInput)).status).toBe(
        "success",
      );
      expect(state.calls[0]).toEqual({
        name: "procurement_save_supplier",
        args: {
          p_organization_id: org,
          p_store_id: store,
          p_supplier_id: id,
          p_name: "Ateliê do Fornecedor",
          p_contact: "Contato fictício",
          p_active: true,
          p_expected_revision: "0",
          p_idempotency_key: id,
        },
      });
      expect((await createPurchaseOrder(scope, purchaseInput)).status).toBe(
        "success",
      );
      expect(state.calls[1].args.p_items).toEqual([
        { variant_id: variant, quantity: 3, unit_cost_cents: 1234 },
      ]);
    },
  );
  it.each(["owner", "manager", "stockist"])(
    "%s receives and refreshes inventory",
    async (role) => {
      state.role = role;
      expect((await receivePurchaseOrder(scope, transition)).status).toBe(
        "success",
      );
      expect(state.revalidated).toEqual(["/app/compras", "/app/estoque"]);
    },
  );
  it("separates buyer management from stockist receiving", async () => {
    state.role = "buyer";
    expect((await receivePurchaseOrder(scope, transition)).status).toBe(
      "denied",
    );
    expect((await authorizeProcurement(scope)).canManage).toBe(true);
    state.role = "stockist";
    expect((await saveProcurementSupplier(scope, supplierInput)).status).toBe(
      "denied",
    );
    expect((await createPurchaseOrder(scope, purchaseInput)).status).toBe(
      "denied",
    );
    expect(
      (
        await cancelPurchaseOrder(scope, {
          ...transition,
          reason: "Cancelamento",
        })
      ).status,
    ).toBe("denied");
    expect((await authorizeProcurement(scope)).canReceive).toBe(true);
    expect(state.calls).toHaveLength(0);
  });
  it.each(["cashier", "driver", "marketing", "finance"])(
    "%s cannot see costs or mutate",
    async (role) => {
      state.role = role;
      await expect(authorizeProcurement(scope)).rejects.toMatchObject({
        kind: "denied",
      });
      expect((await createPurchaseOrder(scope, purchaseInput)).status).toBe(
        "denied",
      );
      expect(state.calls).toHaveLength(0);
    },
  );
  it("reauthorizes repeated requests after session, membership or store revocation", async () => {
    await createPurchaseOrder(scope, purchaseInput);
    for (const flag of ["signedIn", "active", "storeAllowed"] as const) {
      state[flag] = false;
      expect((await createPurchaseOrder(scope, purchaseInput)).status).toBe(
        "denied",
      );
      state[flag] = true;
    }
    expect(state.calls).toHaveLength(1);
  });
  it("refuses foreign scope and invalid data before RPC", async () => {
    for (const foreign of [
      { ...scope, organizationId: id },
      { ...scope, storeId: id },
      { ...scope, storeId: "bad" },
    ]) {
      expect(
        (await createPurchaseOrder(foreign, purchaseInput)).status,
      ).toMatch(/denied|invalid/);
    }
    for (const input of [
      { ...purchaseInput, items: [] },
      {
        ...purchaseInput,
        items: [...purchaseInput.items, ...purchaseInput.items],
      },
      {
        ...purchaseInput,
        items: [{ ...purchaseInput.items[0], unitCost: "1e5" }],
      },
      { ...purchaseInput, idempotencyKey: "bad" },
    ])
      expect((await createPurchaseOrder(scope, input)).status).toBe("invalid");
    expect(state.calls).toHaveLength(0);
  });
  it.each([
    ["PT409", "conflict"],
    ["23505", "duplicate"],
    ["42501", "denied"],
    ["22023", "invalid"],
    ["23514", "invalid"],
    ["40001", "unavailable"],
    ["PGRST202", "unavailable"],
  ])("sanitizes %s into %s", async (code, status) => {
    state.rpcError = code;
    const result = await receivePurchaseOrder(scope, transition);
    expect(result.status).toBe(status);
    expect(result.message).not.toContain("private");
    expect(state.revalidated).toHaveLength(0);
  });
  it("does not treat an ambiguous response as success", async () => {
    state.throwRpc = true;
    expect((await receivePurchaseOrder(scope, transition)).status).toBe(
      "unavailable",
    );
    state.throwRpc = false;
    for (const response of [
      null,
      [],
      [{ id, revision: "0" }],
      [{ id, revision: "9223372036854775808" }],
      [{ id: "bad", revision: "1" }],
    ]) {
      state.response = response;
      expect((await receivePurchaseOrder(scope, transition)).status).toBe(
        "unavailable",
      );
    }
    expect(state.revalidated).toHaveLength(0);
  });
  it("normalizes cancellation reason without trusting a client actor", async () => {
    expect(
      (
        await cancelPurchaseOrder(scope, {
          ...transition,
          reason: "  Pedido duplicado  ",
        })
      ).status,
    ).toBe("success");
    expect(state.calls[0].args).toEqual({
      p_organization_id: org,
      p_store_id: store,
      p_order_id: id,
      p_expected_revision: "1",
      p_idempotency_key: id,
      p_reason: "Pedido duplicado",
    });
  });
});
describe("Procurement wire reads", () => {
  const supplierRow = {
    id,
    name: "Fornecedor",
    contact: "",
    active: true,
    revision: "1",
    total_count: "1",
  };
  const orderRow = {
    id,
    supplier_id: variant,
    supplier_name: "Fornecedor",
    status: "open",
    revision: "1",
    total_cents: "3702",
    created_at: "2026-10-09T12:00:00Z",
    received_at: null,
    cancellation_reason: null,
    total_count: "1",
  };
  it("scopes suppliers and stable pagination including empty out-of-range pages", async () => {
    state.responses.push([], [supplierRow]);
    const result = await listProcurementSuppliers(scope, {
      query: " Fornecedor ",
      page: 2,
      pageSize: 10,
    });
    expect(result).toMatchObject({ page: 2, total: 1, items: [] });
    expect(state.calls[0].args).toMatchObject({
      p_organization_id: org,
      p_store_id: store,
      p_query: "Fornecedor",
      p_offset: 10,
    });
    expect(state.calls[1].args.p_offset).toBe(0);
  });
  it("normalizes the nullable optional supplier contact for presentation", async () => {
    state.response = [{ ...supplierRow, contact: null }];
    expect((await listProcurementSuppliers(scope)).items[0].contact).toBe("");
  });
  it("validates cost integer wire and selector isolation", async () => {
    state.response = [orderRow];
    expect(await listPurchaseOrders(scope, { status: "open" })).toMatchObject({
      total: 1,
      items: [{ totalCents: 3702 }],
    });
    state.response = [{ ...orderRow, id: variant }];
    await expect(getPurchaseOrder(scope, id)).rejects.toMatchObject({
      kind: "unavailable",
    });
    state.response = [{ ...orderRow, total_cents: "100000000001" }];
    await expect(listPurchaseOrders(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
  it("returns snapshot detail without reusing catalog prices", async () => {
    state.responses.push(
      [orderRow],
      [
        {
          variant_id: variant,
          product_name: "Camiseta snapshot",
          sku: "CAM-P",
          quantity: "3",
          unit_cost_cents: "1234",
        },
      ],
    );
    expect(await getPurchaseOrder(scope, id)).toMatchObject({
      order: { totalCents: 3702 },
      items: [{ quantity: 3, unitCostCents: 1234 }],
    });
    expect(state.calls[1]).toMatchObject({
      name: "procurement_order_items",
      args: { p_order_id: id, p_organization_id: org, p_store_id: store },
    });
  });
  it("separates denied, malformed input and unavailable provider", async () => {
    state.rpcError = "42501";
    await expect(listPurchaseOrders(scope)).rejects.toMatchObject({
      kind: "denied",
    });
    state.rpcError = "PGRST202";
    await expect(listPurchaseOrders(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    state.throwRpc = true;
    await expect(listProcurementSuppliers(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(getPurchaseOrder(scope, "bad")).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  it("variant search returns only active SKU and reauthorizes procurement", async () => {
    state.response = [
      {
        variant_id: variant,
        product_name: "Camiseta",
        sku: "CAM-P",
        color: null,
        size: null,
        active: true,
        quantity: 0,
        revision: "0",
        total_count: 2,
      },
      {
        variant_id: id,
        product_name: "Inativo",
        sku: "OFF",
        color: null,
        size: null,
        active: false,
        quantity: 0,
        revision: "0",
        total_count: 2,
      },
    ];
    expect(await findPurchaseVariants(scope, "CAM")).toEqual({
      status: "success",
      items: [{ variantId: variant, productName: "Camiseta", sku: "CAM-P" }],
    });
    state.role = "cashier";
    expect((await findPurchaseVariants(scope, "CAM")).status).toBe("denied");
    expect(state.calls).toHaveLength(1);
  });
});
