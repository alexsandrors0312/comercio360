import { beforeEach, describe, expect, it, vi } from "vitest";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const storeA = "33333333-3333-4333-8333-333333333333";
const storeB = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

const state = vi.hoisted(() => ({
  memberRole: "owner" as string | null,
  memberActive: true,
  storeAccess: true,
  rpcError: null as string | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/supabase/server", () => ({
  isConfigured: () => true,
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
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
          if (table === "memberships") {
            const allowed =
              state.memberActive &&
              state.memberRole &&
              filters.organization_id === orgA &&
              filters.user_id === userId &&
              filters.active === true;
            return {
              data: allowed ? { role: state.memberRole } : null,
              error: null,
            };
          }
          if (table === "stores") {
            const allowed =
              state.storeAccess &&
              filters.organization_id === orgA &&
              filters.id === storeA &&
              filters.active === true;
            return { data: allowed ? { id: storeA } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return {
        data: [{ id: "66666666-6666-4666-8666-666666666666", revision: 1 }],
        error: state.rpcError
          ? { code: state.rpcError, message: "private provider details" }
          : null,
      };
    },
  }),
}));

import { authorizeCatalog, CatalogAccessError } from "../lib/catalog/server";
import { createCatalogCategory } from "../app/actions/catalog";

const scopeA = { organizationId: orgA, storeId: storeA };

beforeEach(() => {
  state.memberRole = "owner";
  state.memberActive = true;
  state.storeAccess = true;
  state.rpcCalls.length = 0;
  state.rpcError = null;
});

describe("catalog application authorization", () => {
  it("maps a domain PT409 to conflict without exposing the provider response", async () => {
    state.rpcError = "PT409";
    const result = await createCatalogCategory(scopeA, { name: "Blusas" });
    expect(result.status).toBe("conflict");
    expect(result.message).not.toContain("private provider details");
    state.rpcError = "40001";
    expect(
      (await createCatalogCategory(scopeA, { name: "Blusas" })).status,
    ).toBe("unavailable");
  });
  it("requires an active member with an explicit active store for writes", async () => {
    const granted = await authorizeCatalog(scopeA, "write");
    expect(granted.role).toBe("owner");
    state.memberActive = false;
    await expect(authorizeCatalog(scopeA, "write")).rejects.toMatchObject({
      kind: "denied",
    } satisfies Partial<CatalogAccessError>);
  });

  it("keeps read roles from mutating and denies revoked store access on the next call", async () => {
    state.memberRole = "cashier";
    await expect(authorizeCatalog(scopeA, "read")).resolves.toMatchObject({
      canWrite: false,
    });
    await expect(authorizeCatalog(scopeA, "write")).rejects.toMatchObject({
      kind: "denied",
    });
    state.memberRole = "manager";
    state.storeAccess = false;
    await expect(authorizeCatalog(scopeA, "read")).rejects.toMatchObject({
      kind: "denied",
    });
  });

  it("does not treat a valid ID from another tenant as permission", async () => {
    await expect(
      authorizeCatalog({ organizationId: orgB, storeId: storeB }),
    ).rejects.toMatchObject({ kind: "denied" });
  });

  it("does not invoke RPC after revocation and supplies only validated business fields on success", async () => {
    const ok = await createCatalogCategory(scopeA, { name: "  Blusas  " });
    expect(ok.status).toBe("success");
    expect(state.rpcCalls).toEqual([
      {
        name: "catalog_create_category",
        args: { p_organization_id: orgA, p_store_id: storeA, p_name: "Blusas" },
      },
    ]);
    state.memberActive = false;
    const denied = await createCatalogCategory(scopeA, { name: "Outra" });
    expect(denied.status).toBe("denied");
    expect(state.rpcCalls).toHaveLength(1);
  });
});
