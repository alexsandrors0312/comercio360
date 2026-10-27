import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  isConfigured: source.configured,
  createClient: async () => ({ auth: { getUser: source.getUser }, rpc: source.rpc }),
}));

import {
  executeMarketingSave,
  readMarketingProducts,
  readMarketingRich,
} from "../lib/marketing/server";

const scope = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  storeId: "10000000-0000-4000-8000-000000000011",
};
const campaignId = "20000000-0000-4000-8000-000000000001";
const variantId = "30000000-0000-4000-8000-000000000001";
const key = "40000000-0000-4000-8000-000000000001";
const save = {
  scope, campaignId, expectedRevision: "2", objective: "promotion",
  contentBody: "Texto fictício para a loja.", variantIds: [variantId], key,
};

beforeEach(() => {
  vi.resetAllMocks();
  source.configured.mockReturnValue(true);
  source.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  source.rpc.mockResolvedValue({ data: { id: campaignId, status: "draft", revision: "3" }, error: null });
});

describe("Marketing 013: adaptador autenticado", () => {
  it("rejeita variantes duplicadas e escopo malformado antes de consultar o banco", async () => {
    expect((await executeMarketingSave({ ...save, variantIds: [variantId, variantId] })).status).toBe("invalid");
    expect((await executeMarketingSave({ ...save, scope: { ...scope, storeId: "outra" } })).status).toBe("invalid");
    expect(source.getUser).not.toHaveBeenCalled();
    expect(source.rpc).not.toHaveBeenCalled();
  });

  it("passa escopo, revisão, chave e conteúdo à RPC sem chave administrativa", async () => {
    expect(await executeMarketingSave(save)).toEqual({
      status: "success", result: { id: campaignId, status: "draft", revision: "3" },
    });
    expect(source.rpc).toHaveBeenCalledWith("marketing_rich_save", {
      p_org: scope.organizationId, p_store: scope.storeId,
      p_campaign: campaignId, p_expected_revision: "2", p_objective: "promotion",
      p_content: save.contentBody, p_variants: [variantId], p_key: key,
    });
  });

  it("bloqueia sessão ausente e não devolve erro interno do provedor", async () => {
    source.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await executeMarketingSave(save)).status).toBe("denied");
    expect(source.rpc).not.toHaveBeenCalled();
    source.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
    source.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private policy details" } });
    const denied = await executeMarketingSave(save);
    expect(denied.status).toBe("denied");
    expect(JSON.stringify(denied)).not.toContain("private policy details");
  });

  it("distingue conflito de infraestrutura e preserva resposta incerta", async () => {
    source.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409", message: "private lock" } });
    expect((await executeMarketingSave(save)).status).toBe("conflict");
    source.rpc.mockRejectedValueOnce(new Error("private transport"));
    const unknown = await executeMarketingSave(save);
    expect(unknown.status).toBe("unknown");
    expect(JSON.stringify(unknown)).not.toContain("private transport");
  });

  it("limita a consulta de candidatos e usa apenas a loja informada", async () => {
    await expect(readMarketingProducts({ scope, query: "x", limit: 51, offset: 0 }))
      .rejects.toMatchObject({ kind: "invalid" });
    expect(source.rpc).not.toHaveBeenCalled();
    source.rpc.mockResolvedValue({ data: { items: [], total: 0 }, error: null });
    expect(await readMarketingProducts({ scope, query: "camisa", limit: 20, offset: 0 }))
      .toEqual({ items: [], total: 0 });
    expect(source.rpc).toHaveBeenCalledWith("marketing_product_search", {
      p_org: scope.organizationId, p_store: scope.storeId,
      p_query: "camisa", p_limit: 20, p_offset: 0,
    });
  });

  it("aceita período limitado e mantém preço ausente como desconhecido", async () => {
    const product = {
      variantId, productId: "50000000-0000-4000-8000-000000000001",
      name: "Camisa fictícia", sku: "TEST-1", color: null, size: "M",
      priceCents: null, quantity: 0, hasCover: true,
    };
    source.rpc.mockResolvedValue({ data: { campaigns: [{
      id: campaignId, title: "Teste", channel: "store", plannedAt: "2026-11-01T12:00:00Z",
      status: "draft", revision: "1", createdAt: "2026-10-26T12:00:00Z",
      objective: "institutional", contentBody: "", products: [product],
    }], hasMore: false }, error: null });
    const data = await readMarketingRich(scope, "2026-10-26T00:00:00Z", "2026-11-05T00:00:00Z");
    expect(data.campaigns[0].products[0].priceCents).toBeNull();
    await expect(readMarketingRich(scope, "2026-01-01T00:00:00Z", "2026-05-01T00:00:00Z"))
      .rejects.toMatchObject({ kind: "invalid" });
  });
});
