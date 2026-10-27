import { z } from "zod";
import { authorizedMarketingClient, MarketingAccessError } from "@/lib/marketing/server";

export const runtime = "nodejs";

const BUCKET = "catalog-private";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
type Context = { params: Promise<{ productId: string }> };

function failure(status: number, message: string) {
  return Response.json({ status: "error", message }, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request: Request, { params }: Context) {
  const { productId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  const storeId = url.searchParams.get("storeId") ?? "";
  if (!z.uuid().safeParse(productId).success ||
    !z.uuid().safeParse(organizationId).success ||
    !z.uuid().safeParse(storeId).success)
    return failure(400, "Seleção de capa inválida.");

  try {
    const client = await authorizedMarketingClient({ organizationId, storeId });
    const path = await client.rpc("marketing_cover_path", {
      p_org: organizationId,
      p_store: storeId,
      p_product: productId,
    });
    if (path.error) {
      if (path.error.code === "42501") return failure(403, "Acesso negado.");
      if (path.error.code === "22023") return failure(400, "Seleção de capa inválida.");
      return failure(503, "Não foi possível carregar a capa agora.");
    }
    if (typeof path.data !== "string" || !path.data)
      return failure(404, "Capa não encontrada.");

    const download = await client.storage.from(BUCKET).download(path.data);
    if (download.error || !download.data) {
      const code = String(download.error?.statusCode ?? "");
      if (code === "403" || code === "401") return failure(403, "Acesso negado.");
      if (code === "404") return failure(404, "Capa não encontrada.");
      return failure(503, "Não foi possível carregar a capa agora.");
    }
    const blob = download.data;
    if (!IMAGE_TYPES.has(blob.type) || blob.size < 1 || blob.size > MAX_IMAGE_BYTES)
      return failure(503, "A capa está indisponível.");
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type,
        "Content-Length": String(blob.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof MarketingAccessError)
      return failure(error.kind === "denied" ? 403 : error.kind === "invalid" ? 400 : 503, error.message);
    return failure(503, "Não foi possível carregar a capa agora.");
  }
}
