import { CatalogImageError } from "./contracts";

export async function readBoundedMultipart(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new CatalogImageError("invalid", "Envie uma imagem válida.");
  }
  const reader = request.body?.getReader();
  if (!reader)
    throw new CatalogImageError("invalid", "Envie uma imagem válida.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CatalogImageError("too_large", "A imagem deve ter até 5 MB.");
      }
      chunks.push(Buffer.from(value));
    }
    if (size === 0)
      throw new CatalogImageError("invalid", "Envie uma imagem válida.");
    const bounded = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: Buffer.concat(chunks, size),
    });
    return await bounded.formData();
  } catch (error) {
    if (error instanceof CatalogImageError) throw error;
    throw new CatalogImageError("invalid", "Envie uma imagem válida.");
  } finally {
    reader.releaseLock();
  }
}
