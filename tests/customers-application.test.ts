import { beforeEach, describe, expect, it, vi } from "vitest";
const org = "10000000-0000-4000-8000-000000000001";
const store = "10000000-0000-4000-8000-000000000011";
const user = "a0000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000901";
const key = "10000000-0000-4000-8000-000000000902";
const membership = "10000000-0000-4000-8000-000000000903";
const state = vi.hoisted(() => ({
  role: "manager" as string | null,
  signedIn: true,
  active: true,
  storeAllowed: true,
  grantAllowed: true,
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
  revalidatePath: (path: string) => state.revalidated.push(path),
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
        async limit() {
          return {
            data: table === "user_store_access" && state.grantAllowed &&
              filters.organization_id === org && filters.membership_id === membership &&
              filters.store_id === store ? [{ store_id: store }] : [],
            error: state.providerError ? { message: "private" } : null,
          };
        },
        async maybeSingle() {
          const valid = filters.organization_id === org && filters.active === true;
          return {
            data: table === "memberships"
              ? valid && filters.user_id === user && state.active && state.role
                ? { id: membership, role: state.role }
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
      if (state.throwRpc) throw new Error("private provider details");
      return {
        data: state.responses.length ? state.responses.shift() : state.response,
        error: state.rpcError ? { code: state.rpcError, message: "private" } : null,
      };
    },
  }),
}));

import {
  authorizeCustomers,
  getCustomerPermissions,
  listCustomers,
  getCustomer,
  listCustomerSales,
} from "../lib/customers/server";
import { saveCustomer, findCustomers } from "../app/actions/customers";

const scope = { organizationId: org, storeId: store };
const input = {
  customerId: null,
  expectedRevision: null,
  name: "  Cliente Fictícia  ",
  phone: "(11) 99999-1234",
  email: " TESTE@EXAMPLE.TEST ",
  active: true,
  idempotencyKey: key,
};
const row = {
  id,
  name: "Cliente Fictícia",
  phone: "11999991234",
  email: "teste@example.test",
  active: true,
  revision: "1",
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  total_count: "1",
};
beforeEach(() => {
  Object.assign(state, {
    role: "manager",
    signedIn: true,
    active: true,
    storeAllowed: true,
    grantAllowed: true,
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

describe("Clientes: autorização e gravação", () => {
  it.each(["owner", "manager", "cashier"])("%s may create but only management may edit", async (role) => {
    state.role = role;
    expect((await saveCustomer(scope, input)).status).toBe("success");
    expect(state.calls[0]).toEqual({
      name: "customers_save",
      args: {
        p_organization_id: org,
        p_store_id: store,
        p_customer_id: null,
        p_expected_revision: null,
        p_name: "Cliente Fictícia",
        p_phone: "11999991234",
        p_email: "teste@example.test",
        p_active: true,
        p_idempotency_key: key,
      },
    });
    expect(await getCustomerPermissions(scope)).toEqual({
      canCreate: true,
      canEdit: role !== "cashier",
      userId: user,
    });
    const edit = { ...input, customerId: id, expectedRevision: "1", active: false };
    expect((await saveCustomer(scope, edit)).status).toBe(role === "cashier" ? "denied" : "success");
  });
  it("rechecks session, role, membership and store before replay", async () => {
    await saveCustomer(scope, input);
    for (const flag of ["signedIn", "active", "storeAllowed", "grantAllowed"] as const) {
      state[flag] = false;
      expect((await saveCustomer(scope, input)).status).toBe("denied");
      state[flag] = true;
    }
    state.role = "buyer";
    expect((await saveCustomer(scope, input)).status).toBe("denied");
    expect(state.calls).toHaveLength(1);
  });
  it("rejects malformed and out-of-scope input without writing", async () => {
    for (const value of [
      { ...input, name: "X" },
      { ...input, phone: "123" },
      { ...input, email: "bad" },
      { ...input, active: false },
      { ...input, customerId: id },
      { ...input, idempotencyKey: "bad" },
    ]) expect((await saveCustomer(scope, value)).status).toBe("invalid");
    expect((await saveCustomer({ ...scope, storeId: id }, input)).status).toBe("denied");
    expect(state.calls).toHaveLength(0);
  });
  it.each([
    ["42501", "denied"], ["PT409", "conflict"], ["22023", "invalid"],
    ["40001", "unavailable"], ["PGRST202", "unavailable"],
  ])("maps provider %s without exposing private details", async (code, expected) => {
    state.rpcError = code;
    const result = await saveCustomer(scope, input);
    expect(result.status).toBe(expected);
    expect(result.message).not.toContain("private");
    expect(state.revalidated).toHaveLength(0);
  });
  it("treats a lost or malformed response as uncertain and refreshes only success", async () => {
    state.throwRpc = true;
    expect((await saveCustomer(scope, input)).status).toBe("unavailable");
    state.throwRpc = false;
    for (const response of [null, [], [{ id: "bad", revision: "1" }]]) {
      state.response = response;
      expect((await saveCustomer(scope, input)).status).toBe("unavailable");
    }
    state.response = [{ id, revision: "1" }];
    expect((await saveCustomer(scope, input)).status).toBe("success");
    expect(state.revalidated).toEqual(["/app/clientes", "/app/pdv"]);
  });
});

describe("Clientes: leituras limitadas e DTOs", () => {
  it("normalizes list rows and preserves total on an empty later page", async () => {
    state.responses.push([], [row]);
    expect(await listCustomers(scope, { query: " Fictícia ", page: 2, pageSize: 1 })).toEqual({
      items: [], page: 2, pageSize: 1, total: 1,
    });
    expect(state.calls[0]).toMatchObject({
      name: "customers_list",
      args: { p_query: "Fictícia", p_offset: 1, p_store_id: store },
    });
    state.response = [row];
    expect(await getCustomer(scope, id)).toMatchObject({ id, name: "Cliente Fictícia" });
  });
  it("searches active customers and limits history to selected store", async () => {
    state.response = [row];
    expect((await findCustomers(scope, " Cliente ")).status).toBe("success");
    expect(state.calls[0]).toMatchObject({
      name: "customers_list", args: { p_status: "active", p_query: "Cliente" },
    });
    const sale = {
      id: key, status: "confirmed", revision: "1", total_cents: "2500",
      created_at: "2026-10-10T10:01:00Z", cancelled_at: null,
      customer_name_snapshot: "Cliente Fictícia", total_count: "1",
    };
    state.response = [sale];
    expect(await listCustomerSales(scope, id)).toMatchObject({
      items: [{ id: key, totalCents: 2500 }], total: 1,
    });
    expect(state.calls[1]).toMatchObject({
      name: "customers_sales", args: { p_customer_id: id, p_store_id: store },
    });
  });
  it("rejects invalid and denied reads without leaking provider rows", async () => {
    await expect(getCustomer(scope, "bad")).rejects.toMatchObject({ kind: "invalid" });
    state.role = "stockist";
    await expect(authorizeCustomers(scope)).rejects.toMatchObject({ kind: "denied" });
    state.role = "manager";
    state.response = [{ ...row, revision: "0" }];
    await expect(listCustomers(scope)).rejects.toMatchObject({ kind: "unavailable" });
  });
});
