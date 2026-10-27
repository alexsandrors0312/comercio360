import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({
  authorized: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/marketing/server", () => ({
  authorizedMarketingClient: source.authorized,
  MarketingAccessError: class MarketingAccessError extends Error {
    constructor(public kind: "denied" | "invalid" | "unknown") { super("safe"); }
  },
}));

import { GET } from "../app/api/marketing/covers/[productId]/route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const storeId = "10000000-0000-4000-8000-000000000011";
const productId = "20000000-0000-4000-8000-000000000001";
const request = () => new Request(
  `https://example.test/api/marketing/covers/${productId}?organizationId=${organizationId}&storeId=${storeId}`,
);
const context = () => ({ params: Promise.resolve({ productId }) });

beforeEach(() => {
  vi.resetAllMocks();
  source.authorized.mockImplementation(async () => ({
    rpc: source.rpc,
    storage: { from: (bucket: string) => {
      expect(bucket).toBe("catalog-private");
      return { download: source.download };
    } },
  }));
  source.rpc.mockResolvedValue({ data: "private/opaque/path", error: null });
  source.download.mockResolvedValue({ data: new Blob(["jpeg"], { type: "image/jpeg" }), error: null });
});

describe("Capa privada de Marketing 013", () => {
  it("nega parâmetros inválidos antes de acessar a sessão", async () => {
    const response = await GET(new Request(`https://example.test/api/marketing/covers/${productId}?organizationId=x&storeId=${storeId}`), context());
    expect(response.status).toBe(400);
    expect(source.authorized).not.toHaveBeenCalled();
  });

  it("reautoriza por loja e devolve bytes same-origin sem caminho ou URL assinada", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("jpeg");
    expect(source.authorized).toHaveBeenCalledWith({ organizationId, storeId });
    expect(source.rpc).toHaveBeenCalledWith("marketing_cover_path", {
      p_org: organizationId, p_store: storeId, p_product: productId,
    }, { get: true });
    expect(source.download).toHaveBeenCalledWith("private/opaque/path");
  });

  it("distingue acesso negado, capa ausente e Storage indisponível sem detalhes privados", async () => {
    source.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private auth data" } });
    const denied = await GET(request(), context());
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("private auth data");
    expect(source.download).not.toHaveBeenCalled();
    source.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(request(), context())).status).toBe(404);
    source.download.mockResolvedValueOnce({ data: null, error: { statusCode: "503", message: "private path" } });
    const unavailable = await GET(request(), context());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private path");
  });

  it("não serve conteúdo inesperado como imagem", async () => {
    source.download.mockResolvedValueOnce({ data: new Blob(["<script>"], { type: "text/html" }), error: null });
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
