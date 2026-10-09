import { beforeEach, describe, expect, it, vi } from "vitest";

const org = "10000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const variant = "10000000-0000-4000-8000-000000000301";
const user = "a0000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000901";
const state = vi.hoisted(() => ({
  role: "manager" as string | null,
  storeAllowed: true,
  active: true,
  signedIn: true,
  configured: true,
  rpcError: null as string | null,
  throwRpc: false,
  response: null as unknown,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  revalidated: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (value: string) => state.revalidated.push(value),
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
      if (state.throwRpc) throw new Error("private infrastructure details");
      return {
        data: state.response,
        error: state.rpcError
          ? { code: state.rpcError, message: "private database details" }
          : null,
      };
    },
  }),
}));

import {
  authorizeInventory,
  getInventoryItem,
  listInventoryHistory,
  listInventoryStock,
} from "../lib/inventory/server";
import { recordInventoryMovement } from "../app/actions/inventory";
const scope = { organizationId: org, storeId: store };
const input = {
  variantId: variant,
  kind: "entry" as const,
  quantity: "5",
  reason: " Contagem inicial ",
  expectedRevision: "0",
  idempotencyKey: id,
};

beforeEach(() => {
  Object.assign(state, {
    role: "manager",
    storeAllowed: true,
    active: true,
    signedIn: true,
    configured: true,
    rpcError: null,
    throwRpc: false,
    response: [{ id, revision: "1", quantity: 5 }],
  });
  state.calls.length = 0;
  state.revalidated.length = 0;
});

describe("Inventory server authorization and mutations", () => {
  it.each(["owner", "manager", "stockist"])(
    "allows %s to write without client actor identity",
    async (role) => {
      state.role = role;
      const result = await recordInventoryMovement(scope, input);
      expect(result).toEqual({
        status: "success",
        message: "Movimentação registrada.",
        id,
        revision: "1",
        quantity: 5,
      });
      expect(state.calls).toEqual([
        {
          name: "inventory_move",
          args: {
            p_organization_id: org,
            p_store_id: store,
            p_variant_id: variant,
            p_kind: "entry",
            p_quantity: 5,
            p_reason: "Contagem inicial",
            p_expected_revision: "0",
            p_idempotency_key: id,
          },
        },
      ]);
      expect(state.revalidated).toEqual(["/app/estoque"]);
    },
  );
  it.each(["cashier", "buyer"])("allows %s to read only", async (role) => {
    state.role = role;
    expect((await authorizeInventory(scope)).canWrite).toBe(false);
    expect((await recordInventoryMovement(scope, input)).status).toBe("denied");
    expect(state.calls).toHaveLength(0);
  });
  it("rechecks revoked session, membership and store grant on each submission", async () => {
    expect((await recordInventoryMovement(scope, input)).status).toBe(
      "success",
    );
    for (const flag of ["active", "storeAllowed", "signedIn"] as const) {
      state[flag] = false;
      expect((await recordInventoryMovement(scope, input)).status).toBe(
        "denied",
      );
      state[flag] = true;
    }
    expect(state.calls).toHaveLength(1);
  });
  it("refuses cross-tenant/store and malformed scope before a stock RPC", async () => {
    for (const foreign of [
      { ...scope, organizationId: id },
      { ...scope, storeId: id },
      { ...scope, storeId: "bad" },
    ]) {
      expect((await recordInventoryMovement(foreign, input)).status).toMatch(
        /denied|invalid/,
      );
    }
    expect(state.calls).toHaveLength(0);
  });
  it("rejects malformed input without sending a mutation", async () => {
    for (const change of [
      { quantity: "0" },
      { quantity: "1e3" },
      { quantity: "-1" },
      { reason: "a" },
      { expectedRevision: "-1" },
      { idempotencyKey: "bad" },
    ]) {
      expect(
        (await recordInventoryMovement(scope, { ...input, ...change })).status,
      ).toBe("invalid");
    }
    expect(state.calls).toHaveLength(0);
  });
  it.each([
    ["PT409", "conflict"],
    ["PT422", "insufficient"],
    ["42501", "denied"],
    ["22023", "invalid"],
    ["22003", "invalid"],
    ["40001", "unavailable"],
  ])(
    "maps %s into %s without leaking provider details",
    async (code, expected) => {
      state.rpcError = code;
      const result = await recordInventoryMovement(scope, input);
      expect(result.status).toBe(expected);
      expect(result.message).not.toContain("private");
      expect(state.revalidated).toHaveLength(0);
    },
  );
  it("treats network failure and ambiguous results as unavailable", async () => {
    state.throwRpc = true;
    expect((await recordInventoryMovement(scope, input)).status).toBe(
      "unavailable",
    );
    state.throwRpc = false;
    for (const response of [
      null,
      [],
      [{ id, revision: "0", quantity: 5 }],
      [{ id, revision: "1", quantity: -1 }],
    ]) {
      state.response = response;
      expect((await recordInventoryMovement(scope, input)).status).toBe(
        "unavailable",
      );
    }
  });
});

describe("Inventory reads", () => {
  const row = {
    variant_id: variant,
    product_name: "Camiseta",
    sku: "CAM-P",
    color: null,
    size: "P",
    active: true,
    quantity: "0",
    revision: "0",
    total_count: "1",
  };
  it("validates stock wire data and scopes pagination/selection", async () => {
    state.response = [row];
    expect(
      await listInventoryStock(scope, {
        query: " CAM ",
        page: 2,
        pageSize: 10,
      }),
    ).toMatchObject({
      page: 2,
      total: 1,
      items: [{ variantId: variant, quantity: 0, revision: "0" }],
    });
    expect(state.calls[0].args).toMatchObject({
      p_organization_id: org,
      p_store_id: store,
      p_query: "CAM",
      p_offset: 10,
      p_limit: 10,
    });
    expect(await getInventoryItem(scope, variant)).toMatchObject({
      variantId: variant,
    });
    expect(state.calls[1].args.p_variant_id).toBe(variant);
  });
  it("does not accept another variant or corrupted balances from an RPC", async () => {
    state.response = [{ ...row, variant_id: id }];
    await expect(getInventoryItem(scope, variant)).rejects.toMatchObject({
      kind: "unavailable",
    });
    state.response = [{ ...row, quantity: "2147483648" }];
    await expect(listInventoryStock(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
  it("separates denied, invalid and missing-migration errors", async () => {
    state.rpcError = "42501";
    await expect(listInventoryStock(scope)).rejects.toMatchObject({
      kind: "denied",
    });
    state.rpcError = "PGRST202";
    await expect(listInventoryStock(scope)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(listInventoryHistory(scope, "bad")).rejects.toMatchObject({
      kind: "invalid",
    });
  });
  it("returns paginated movement history with validated quantities", async () => {
    state.response = [
      {
        id,
        kind: "entry",
        quantity: "5",
        reason: "Contagem inicial",
        balance_after: "5",
        created_at: "2026-10-09T15:00:00Z",
        total_count: "12",
      },
    ];
    const history = await listInventoryHistory(scope, variant, 2);
    expect(history).toMatchObject({
      page: 2,
      total: 12,
      items: [{ balanceAfter: 5, quantity: 5 }],
    });
    expect(state.calls[0].args).toMatchObject({
      p_variant_id: variant,
      p_limit: 10,
      p_offset: 10,
    });
  });
});
