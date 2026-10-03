import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeCatalog, CatalogAccessError } from "@/lib/catalog/server";
import {
  parseCatalogImageKey,
  signCatalogImageAttestation,
} from "@/lib/catalog-image/attestation";
import {
  CatalogImageError,
  processCatalogImage,
} from "@/lib/catalog-image/process";
import { parseCatalogRevision } from "@/packages/domain/catalog";
import { readBoundedMultipart } from "@/lib/catalog-image/form";
import { isSameOrigin } from "@/lib/catalog-image/origin";

export const runtime = "nodejs";
const BUCKET = "catalog-private";
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
type Context = { params: Promise<{ productId: string }> };

function reply(status: number, message: string) {
  return Response.json(
    { status: status === 409 ? "conflict" : "error", message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function sqlFailure(code: string | undefined) {
  if (code === "PT409")
    return reply(409, "O produto mudou. Recarregue e tente novamente.");
  if (code === "42501" || code === "P0002") return reply(403, "Acesso negado.");
  if (code === "22023" || code === "23514")
    return reply(400, "Imagem ou cadastro inválido.");
  return reply(503, "Não foi possível salvar a capa agora.");
}

function accessFailure(error: unknown) {
  if (error instanceof CatalogAccessError) {
    return reply(
      error.kind === "invalid" ? 400 : error.kind === "denied" ? 403 : 503,
      error.message,
    );
  }
  return reply(503, "Não foi possível acessar a capa agora.");
}

export async function GET(request: Request, { params }: Context) {
  const { productId } = await params;
  if (!z.uuid().safeParse(productId).success)
    return reply(404, "Capa não encontrada.");
  const url = new URL(request.url);
  try {
    const access = await authorizeCatalog({
      organizationId: url.searchParams.get("organizationId") ?? "",
      storeId: url.searchParams.get("storeId") ?? "",
    });
    const result = await access.supabase.rpc("catalog_get_cover_path", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_product_id: productId,
    });
    if (result.error) return sqlFailure(result.error.code);
    if (!result.data || typeof result.data !== "string")
      return reply(404, "Capa não encontrada.");
    const signed = await access.supabase.storage
      .from(BUCKET)
      .createSignedUrl(result.data, 300);
    if (signed.error || !signed.data?.signedUrl)
      return reply(503, "Não foi possível carregar a capa.");
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed.data.signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return accessFailure(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const { productId } = await params;
  if (!z.uuid().safeParse(productId).success)
    return reply(400, "Produto inválido.");
  if (!isSameOrigin(request)) return reply(403, "Origem inválida.");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAX_REQUEST_BYTES
    )
      return reply(413, "Envie uma imagem de até 5 MB.");
  }

  let key: Buffer;
  try {
    key = parseCatalogImageKey(process.env.CATALOG_IMAGE_ATTESTATION_KEY);
  } catch {
    return reply(503, "O envio de capas ainda não está configurado.");
  }

  let form: FormData;
  try {
    form = await readBoundedMultipart(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof CatalogImageError && error.code === "too_large")
      return reply(413, error.message);
    return reply(400, "Envie uma imagem válida.");
  }
  const file = form.get("file");
  const revision = parseCatalogRevision(
    String(form.get("expectedRevision") ?? ""),
  );
  if (!(file instanceof File) || !revision)
    return reply(400, "Imagem ou revisão inválida.");
  if (file.size < 1 || file.size > 5 * 1024 * 1024)
    return reply(413, "Envie uma imagem de até 5 MB.");

  try {
    const access = await authorizeCatalog(
      {
        organizationId: String(form.get("organizationId") ?? ""),
        storeId: String(form.get("storeId") ?? ""),
      },
      "write",
    );
    let processed;
    try {
      processed = await processCatalogImage(
        new Uint8Array(await file.arrayBuffer()),
      );
    } catch (error) {
      if (error instanceof CatalogImageError) return reply(400, error.message);
      throw error;
    }

    const reserve = await access.supabase.rpc("catalog_reserve_image", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_product_id: productId,
    });
    if (reserve.error) return sqlFailure(reserve.error.code);
    const row = Array.isArray(reserve.data) ? reserve.data[0] : reserve.data;
    if (
      !row ||
      typeof row.object_id !== "string" ||
      typeof row.object_path !== "string"
    )
      return reply(503, "Não foi possível reservar a capa.");

    const upload = await access.supabase.storage
      .from(BUCKET)
      .upload(row.object_path, processed.bytes, {
        contentType: processed.mimeType,
        upsert: false,
        cacheControl: "0",
      });
    if (upload.error) return reply(503, "Não foi possível enviar a capa.");

    // The server uploads only its reencoded bytes to a new immutable path.
    // Reserved objects have no SELECT policy and cannot receive signed URLs.
    const expectedDigest = createHash("sha256")
      .update(processed.bytes)
      .digest("hex");

    const expiresUnix = Math.floor(Date.now() / 1000) + 120;
    const attestation = {
      organizationId: access.organizationId,
      storeId: access.storeId,
      productId,
      objectId: row.object_id,
      actorUserId: access.userId,
      mimeType: processed.mimeType,
      byteSize: processed.bytes.length,
      width: processed.width,
      height: processed.height,
      sha256Hex: expectedDigest,
      expiresUnix,
    };
    const marked = await access.supabase.rpc("catalog_mark_image_attested", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_object_id: row.object_id,
      p_mime_type: processed.mimeType,
      p_byte_size: processed.bytes.length,
      p_width: processed.width,
      p_height: processed.height,
      p_sha256_hex: expectedDigest,
      p_expires_unix: expiresUnix,
      p_mac_hex: signCatalogImageAttestation(attestation, key),
    });
    if (marked.error) return sqlFailure(marked.error.code);

    const linked = await access.supabase.rpc("catalog_set_cover", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_product_id: productId,
      p_expected_revision: revision,
      p_object_id: row.object_id,
    });
    if (linked.error) return sqlFailure(linked.error.code);
    const linkedRow = Array.isArray(linked.data) ? linked.data[0] : linked.data;
    if (!linkedRow) return reply(503, "Não foi possível vincular a capa.");
    revalidatePath("/app/produtos");
    return Response.json(
      {
        status: "success",
        id: linkedRow.id,
        revision: String(linkedRow.revision),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accessFailure(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { productId } = await params;
  if (!z.uuid().safeParse(productId).success)
    return reply(400, "Produto inválido.");
  if (!isSameOrigin(request)) return reply(403, "Origem inválida.");
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length < 1 || length > 2048)
    return reply(400, "Solicitação inválida.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, "Solicitação inválida.");
  }
  const parsed = z
    .object({
      organizationId: z.uuid(),
      storeId: z.uuid(),
      expectedRevision: z.string(),
    })
    .safeParse(body);
  if (!parsed.success) return reply(400, "Solicitação inválida.");
  const revision = parseCatalogRevision(parsed.data.expectedRevision);
  if (!revision) return reply(400, "Revisão inválida.");

  try {
    const access = await authorizeCatalog(
      {
        organizationId: parsed.data.organizationId,
        storeId: parsed.data.storeId,
      },
      "write",
    );
    const linked = await access.supabase.rpc("catalog_set_cover", {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      p_product_id: productId,
      p_expected_revision: revision,
      p_object_id: null,
    });
    if (linked.error) return sqlFailure(linked.error.code);
    const row = Array.isArray(linked.data) ? linked.data[0] : linked.data;
    if (!row) return reply(503, "Não foi possível remover a capa.");
    revalidatePath("/app/produtos");
    return Response.json(
      { status: "success", id: row.id, revision: String(row.revision) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return accessFailure(error);
  }
}
