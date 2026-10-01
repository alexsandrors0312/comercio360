import sharp from "sharp";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 10_000;
const MAX_PIXELS = 25_000_000;

export class CatalogImageError extends Error {
  constructor(
    public readonly code: "invalid" | "too_large" | "dimensions",
    message: string,
  ) {
    super(message);
    this.name = "CatalogImageError";
  }
}

export type ProcessedCatalogImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

export async function processCatalogImage(
  input: Uint8Array,
): Promise<ProcessedCatalogImage> {
  if (!input.length || input.length > MAX_BYTES) {
    throw new CatalogImageError("too_large", "A imagem deve ter até 5 MB.");
  }

  let metadata;
  try {
    metadata = await sharp(Buffer.from(input), {
      failOn: "error",
      limitInputPixels: MAX_PIXELS,
      pages: 1,
    }).metadata();
  } catch {
    throw new CatalogImageError("invalid", "Arquivo de imagem inválido.");
  }

  const format = metadata.format;
  if (
    (format !== "jpeg" && format !== "png" && format !== "webp") ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new CatalogImageError(
      "invalid",
      "Envie uma imagem JPEG, PNG ou WebP estática.",
    );
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_EDGE ||
    metadata.height > MAX_EDGE ||
    metadata.width * metadata.height > MAX_PIXELS
  ) {
    throw new CatalogImageError(
      "dimensions",
      "A imagem excede as dimensões permitidas.",
    );
  }

  try {
    let pipeline = sharp(Buffer.from(input), {
      failOn: "error",
      limitInputPixels: MAX_PIXELS,
      pages: 1,
    }).rotate();

    if (format === "jpeg") pipeline = pipeline.jpeg({ quality: 88 });
    else if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    else pipeline = pipeline.webp({ quality: 88 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (
      !info.width ||
      !info.height ||
      info.width > MAX_EDGE ||
      info.height > MAX_EDGE ||
      info.width * info.height > MAX_PIXELS
    ) {
      throw new CatalogImageError(
        "dimensions",
        "A imagem excede as dimensões permitidas.",
      );
    }
    if (data.length > MAX_BYTES) {
      throw new CatalogImageError("too_large", "A imagem deve ter até 5 MB.");
    }
    return {
      bytes: data,
      mimeType:
        format === "jpeg"
          ? "image/jpeg"
          : format === "png"
            ? "image/png"
            : "image/webp",
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof CatalogImageError) throw error;
    throw new CatalogImageError("invalid", "Arquivo de imagem inválido.");
  }
}
