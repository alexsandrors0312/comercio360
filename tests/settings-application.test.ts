import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  configured: true,
  user: { id: "11111111-1111-4111-8111-111111111111" },
  authError: null as unknown,
  rpc: vi.fn(),
  signUp: vi.fn(),
  set: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/server", () => ({
  isConfigured: () => mock.configured,
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mock.user },
        error: mock.authError,
      }),
      signUp: mock.signUp,
    },
    rpc: mock.rpc,
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mock.set }) }));
import {
  executeSettings,
  readSettings,
  signUpAccount,
} from "../lib/settings/server";
import { settingsAction } from "../app/actions/settings";
import {
  settingsCommandSchema,
  settingsMutationSchema,
  signupSchema,
} from "../packages/validation/settings";
import {
  clearSettingsAttempt,
  loadSettingsAttempt,
  saveSettingsAttempt,
  settingsAttemptKey,
} from "../packages/ui/settings/attempt";
const org = "11111111-1111-4111-8111-111111111122",
  store = "11111111-1111-4111-8111-111111111133",
  key = "11111111-1111-4111-8111-111111111144";
const scope = { organizationId: org, storeId: store };
const command = {
  kind: "manage",
  scope,
  key,
  mutation: { operation: "create_store", payload: { name: " Loja nova " } },
};
const success = { id: store, revision: "1" };
beforeEach(() => {
  mock.configured = true;
  mock.authError = null;
  mock.rpc.mockReset().mockResolvedValue({ data: success, error: null });
  mock.signUp.mockReset().mockResolvedValue({ data: {}, error: null });
  mock.set.mockReset();
});
describe("009 application identity/RPC boundaries", () => {
  it("normalizes input and sends exact scope to restricted RPC", async () => {
    expect(await executeSettings(command)).toEqual({
      status: "success",
      result: success,
    });
    expect(mock.rpc).toHaveBeenCalledWith("settings_mutate", {
      p_org: org,
      p_store: store,
      p_operation: "create_store",
      p_payload: { name: "Loja nova" },
      p_key: key,
    });
  });
  it("invalid input does not reach RPC", async () => {
    expect(
      (
        await executeSettings({
          ...command,
          scope: { ...scope, storeId: "bad" },
        })
      ).status,
    ).toBe("invalid");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reauthorizes identity for every write and read", async () => {
    mock.authError = new Error("not authenticated");
    expect((await executeSettings(command)).status).toBe("denied");
    await expect(readSettings(scope)).rejects.toMatchObject({ kind: "denied" });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", "denied"],
    ["PT409", "conflict"],
    ["22023", "invalid"],
    ["XX000", "unknown"],
  ])("sanitizes SQL %s to %s", async (code, status) => {
    mock.rpc.mockResolvedValue({
      error: { code, message: "private-provider-detail secret@example.test" },
    });
    const result = await executeSettings(command);
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain("private-provider-detail");
  });
  it("malformed success is uncertain and cannot clear a pending mutation", async () => {
    mock.rpc.mockResolvedValue({ data: {}, error: null });
    expect((await executeSettings(command)).status).toBe("unknown");
  });
  it.each(["onboard", "accept"])(
    "%s requires context in success response",
    async (kind) => {
      const payload =
        kind === "onboard"
          ? { name: "Empresa", storeName: "Loja", displayName: "Pessoa" }
          : { code: key, displayName: "Pessoa" };
      expect((await settingsAction({ kind, key, payload })).status).toBe(
        "unknown",
      );
      expect(mock.set).not.toHaveBeenCalled();
    },
  );
  it("bootstrap and acceptance never accept a user id from input", async () => {
    expect(
      (
        await executeSettings({
          kind: "onboard",
          key,
          payload: {
            name: "Empresa",
            storeName: "Loja",
            displayName: "Pessoa",
            userId: org,
          },
        })
      ).status,
    ).toBe("invalid");
    await executeSettings({
      kind: "accept",
      key,
      payload: { code: key, displayName: "Pessoa" },
    });
    expect(mock.rpc).toHaveBeenCalledWith("settings_accept", {
      p_code: key,
      p_display_name: "Pessoa",
      p_key: key,
    });
  });
  it("read DTO strips unknown fields including token material", async () => {
    mock.rpc.mockResolvedValue({
      data: {
        organization: { id: org, name: "Empresa", revision: "1" },
        stores: [],
        members: [],
        invitations: [],
        code_hash: "private",
      },
      error: null,
    });
    expect(await readSettings(scope)).not.toHaveProperty("code_hash");
  });
  it("selects newly returned scope through authorized set_active_store before cookies", async () => {
    mock.rpc
      .mockResolvedValueOnce({
        data: { ...success, organizationId: org, storeId: store },
        error: null,
      })
      .mockResolvedValueOnce({ error: null });
    expect(
      (
        await settingsAction({
          kind: "onboard",
          key,
          payload: {
            name: "Empresa",
            storeName: "Loja",
            displayName: "Pessoa",
          },
        })
      ).status,
    ).toBe("success");
    expect(mock.rpc).toHaveBeenLastCalledWith("set_active_store", {
      p_organization_id: org,
      p_store_id: store,
    });
    expect(mock.set).toHaveBeenCalledWith(
      "c360-org",
      org,
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );
  });
  it("selection failure after commit is unknown and preserves replay", async () => {
    mock.rpc
      .mockResolvedValueOnce({
        data: { ...success, organizationId: org, storeId: store },
        error: null,
      })
      .mockResolvedValueOnce({ error: { code: "42501" } });
    expect(
      (
        await settingsAction({
          kind: "onboard",
          key,
          payload: {
            name: "Empresa",
            storeName: "Loja",
            displayName: "Pessoa",
          },
        })
      ).status,
    ).toBe("unknown");
    expect(mock.set).not.toHaveBeenCalled();
  });
  it("signup uses public Auth only and returns neutral identity-independent message", async () => {
    const result = await signUpAccount({
      email: " PERSON@example.test ",
      password: "twelve-characters",
    });
    expect(mock.signUp).toHaveBeenCalledWith({
      email: "person@example.test",
      password: "twelve-characters",
    });
    expect(result.message).toContain("não libera acesso");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
describe("009 schemas and attempt recovery", () => {
  it("bounds revisions, role, names and invitation access", () => {
    expect(
      signupSchema.safeParse({ email: "a@example.test", password: "short" })
        .success,
    ).toBe(false);
    expect(
      settingsMutationSchema.safeParse({
        operation: "rename_organization",
        payload: { name: "Empresa", revision: "9223372036854775808" },
      }).success,
    ).toBe(false);
    expect(
      settingsMutationSchema.safeParse({
        operation: "create_store",
        payload: { name: "name\ncontrol" },
      }).success,
    ).toBe(false);
    expect(
      settingsMutationSchema.safeParse({
        operation: "invite",
        payload: {
          email: "a@example.test",
          role: "admin",
          storeIds: [store],
          code: key,
        },
      }).success,
    ).toBe(false);
    expect(
      settingsMutationSchema.safeParse({
        operation: "invite",
        payload: {
          email: "a@example.test",
          role: "cashier",
          storeIds: [],
          code: key,
        },
      }).success,
    ).toBe(false);
  });
  it("storage is scoped and roundtrips exact normalized attempt", () => {
    const map = new Map<string, string>(),
      storage = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          map.set(k, v);
        },
        removeItem: (k: string) => {
          map.delete(k);
        },
      } as Storage;
    const k = settingsAttemptKey(org, store);
    expect(k).not.toBe(settingsAttemptKey(store, org));
    const parsed = settingsCommandSchema.parse(command);
    saveSettingsAttempt(storage, k, parsed);
    expect(loadSettingsAttempt(storage, k)).toEqual(parsed);
    clearSettingsAttempt(storage, k);
    expect(loadSettingsAttempt(storage, k)).toBeNull();
    map.set(k, "{}");
    expect(() => loadSettingsAttempt(storage, k)).toThrow();
  });
  it("persistence must be verifiable before dispatch", () => {
    const storage = {
      setItem: () => {},
      getItem: () => null,
    } as unknown as Storage;
    expect(() =>
      saveSettingsAttempt(storage, "k", settingsCommandSchema.parse(command)),
    ).toThrow();
  });
});
