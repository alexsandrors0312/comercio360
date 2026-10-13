import { beforeEach, describe, expect, it, vi } from "vitest";

const org = "10000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const user = "a0000000-0000-4000-8000-000000000001";
const member = "10000000-0000-4000-8000-000000000903";
const orderId = "10000000-0000-4000-8000-000000000901";
const variantId = "10000000-0000-4000-8000-000000000902";
const customerId = "10000000-0000-4000-8000-000000000904";
const saleId = "10000000-0000-4000-8000-000000000905";
const key = "10000000-0000-4000-8000-000000000906";
const state = vi.hoisted(() => ({
  role: "manager" as string | null,
  signedIn: true,
  memberActive: true,
  storeActive: true,
  grantAllowed: true,
  configured: true,
  rpcError: null as string | null,
  rpcThrow: false,
  response: null as unknown,
  responses: [] as unknown[],
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  paths: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => state.paths.push(path),
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
        select() { return this; },
        eq(field: string, value: unknown) { filters[field] = value; return this; },
        async maybeSingle() {
          return {
            data: table === "memberships"
              ? filters.organization_id === org && filters.user_id === user &&
                  filters.active === true && state.memberActive && state.role
                ? { id: member, role: state.role }
                : null
              : filters.organization_id === org && filters.id === store &&
                  filters.active === true && state.storeActive
                ? { id: store }
                : null,
            error: null,
          };
        },
        async limit() {
          return {
            data: table === "user_store_access" && state.grantAllowed &&
                filters.organization_id === org && filters.membership_id === member &&
                filters.store_id === store
              ? [{ store_id: store }]
              : [],
            error: null,
          };
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (state.rpcThrow) throw new Error("private provider details");
      return {
        data: state.responses.length ? state.responses.shift() : state.response,
        error: state.rpcError ? { code: state.rpcError, message: "private details" } : null,
      };
    },
  }),
}));

import {
  authorizeOrders,
  getOrderDetail,
  getOrderPermissions,
  listOrders,
} from "../lib/orders/server";
import {
  cancelOrder,
  createOrder,
  fulfillOrder,
  searchOrders,
} from "../app/actions/orders";

const scope = { organizationId: org, storeId: store };
const createInput = {
  channel: "counter" as const,
  customerId: null,
  items: [{ variantId, quantity: "2", expectedUnitPriceCents: 1200 }],
  idempotencyKey: key,
};
const row = {
  id: orderId,
  channel: "counter",
  status: "open",
  revision: "1",
  customer_id: null,
  customer_name_snapshot: null,
  item_count: "1",
  total_cents: "2400",
  created_at: "2026-10-10T10:00:00Z",
  fulfilled_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  sale_id: null,
  total_count: "1",
};
beforeEach(() => {
  Object.assign(state, {
    role: "manager",
    signedIn: true,
    memberActive: true,
    storeActive: true,
    grantAllowed: true,
    configured: true,
    rpcError: null,
    rpcThrow: false,
    response: [{ id: orderId, revision: "1", sale_id: null }],
  });
  state.responses.length = 0;
  state.calls.length = 0;
  state.paths.length = 0;
});

describe("Pedidos: fronteira da aplicação", () => {
  it.each(["owner", "manager", "cashier"])(
    "%s pode criar, mas só gestão cancela",
    async (role) => {
      state.role = role;
      expect((await createOrder(scope, createInput)).status).toBe("success");
      expect(state.calls[0]).toEqual({
        name: "orders_create",
        args: {
          p_organization_id: org,
          p_store_id: store,
          p_channel: "counter",
          p_customer_id: null,
          p_items: [{
            variant_id: variantId,
            quantity: 2,
            expected_unit_price_cents: 1200,
          }],
          p_idempotency_key: key,
        },
      });
      expect(await getOrderPermissions(scope)).toEqual({
        canCreate: true,
        canCancel: role !== "cashier",
        canFulfill: true,
        userId: user,
      });
      const result = await cancelOrder(scope, {
        orderId,
        expectedRevision: "1",
        reason: "Cliente desistiu",
        idempotencyKey: key,
      });
      expect(result.status).toBe(role === "cashier" ? "denied" : "success");
    },
  );

  it("reautoriza vínculo, concessão, loja e sessão em cada tentativa", async () => {
    for (const flag of ["signedIn", "memberActive", "storeActive", "grantAllowed"] as const) {
      state[flag] = false;
      expect((await createOrder(scope, createInput)).status).toBe("denied");
      state[flag] = true;
    }
    state.role = "stockist";
    expect((await createOrder(scope, createInput)).status).toBe("denied");
    expect(state.calls).toHaveLength(0);
  });

  it("rejeita pedido WhatsApp sem cliente e entrada alterada antes da RPC", async () => {
    expect((await createOrder(scope, { ...createInput, channel: "whatsapp" })).status)
      .toBe("invalid");
    expect((await createOrder(scope, {
      ...createInput,
      customerId,
      items: [{ ...createInput.items[0], quantity: "0" }],
    })).status).toBe("invalid");
    expect(state.calls).toHaveLength(0);
  });

  it.each([
    ["42501", "denied"],
    ["PT409", "conflict"],
    ["PT422", "insufficient"],
    ["22023", "invalid"],
    ["40001", "unavailable"],
  ])("mapeia erro %s sem expor detalhes privados", async (code, expected) => {
    state.rpcError = code;
    const result = await fulfillOrder(scope, { orderId, expectedRevision: "1", idempotencyKey: key });
    expect(result.status).toBe(expected);
    expect(result.message).not.toContain("private");
    expect(state.paths).toHaveLength(0);
  });

  it("trata resposta perdida como incerta e revalida estoque apenas após venda", async () => {
    state.rpcThrow = true;
    expect((await fulfillOrder(scope, { orderId, expectedRevision: "1", idempotencyKey: key })).status)
      .toBe("unavailable");
    state.rpcThrow = false;
    state.response = [{ id: orderId, revision: "2", sale_id: saleId }];
    expect((await fulfillOrder(scope, { orderId, expectedRevision: "1", idempotencyKey: key })).status)
      .toBe("success");
    expect(state.paths).toEqual(["/app/pedidos", "/app/pdv", "/app/estoque", "/app/clientes"]);
  });

  it("lê DTOs limitados por loja e rejeita resposta inconsistente", async () => {
    state.response = [row];
    expect(await listOrders(scope)).toMatchObject({ items: [{ id: orderId, totalCents: 2400 }], total: 1 });
    expect((await searchOrders(scope, { status: "open", page: 1 })).status).toBe("success");
    state.responses.push([row], [{
      variant_id: variantId,
      product_name: "Bolsa fictícia",
      sku: "BOLSA-1",
      quantity: "2",
      unit_price_cents: "1200",
    }]);
    expect(await getOrderDetail(scope, orderId)).toMatchObject({
      order: { id: orderId },
      items: [{ sku: "BOLSA-1", quantity: 2 }],
    });
    state.response = [{ ...row, status: "fulfilled", sale_id: null }];
    await expect(listOrders(scope)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(authorizeOrders({ ...scope, storeId: "bad" })).rejects.toMatchObject({ kind: "invalid" });
  });
});
