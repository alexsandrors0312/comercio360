import { Buffer } from "node:buffer";
import { inspectStaticImageContainer } from "./animation";
import { CatalogImageError, type ProcessedCatalogImage } from "./contracts";
import { stripPngMetadata, stripWebpMetadata } from "./container-metadata";
import { stripJpegMetadata } from "./jpeg-metadata";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 10_000;
const MAX_PIXELS = 25_000_000;

type Mime = ProcessedCatalogImage["mimeType"];
type ImageInfo = {
  format: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type CatalogImagesBinding = {
  info(input: ReadableStream<Uint8Array>): Promise<ImageInfo>;
  input(input: ReadableStream<Uint8Array>): {
    output(options: {
      format: Mime;
      quality?: number;
      anim: false;
    }): Promise<{ response(): Response }>;
  };
};

export class CatalogImageServiceError extends Error {
  constructor(public readonly code: "quota" | "unavailable") {
    super("O processamento de imagens está indisponível no momento.");
    this.name = "CatalogImageServiceError";
  }
}

function bytesAsStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function assertDimensions(info: ImageInfo): asserts info is ImageInfo & {
  width: number;
  height: number;
} {
  if (
    !Number.isSafeInteger(info.width) ||
    !Number.isSafeInteger(info.height) ||
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
}

async function readBoundedImage(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new CatalogImageServiceError("unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES)
        throw new CatalogImageError("too_large", "A imagem deve ter até 5 MB.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new CatalogImageServiceError("unavailable");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function serviceError(error: unknown): CatalogImageServiceError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? Number(error.code)
      : undefined;
  return new CatalogImageServiceError(code === 9422 ? "quota" : "unavailable");
}

/**
 * Processes private upload bytes using a Cloudflare Images binding. This
 * function has no Cloudflare module import and can be injected by the route.
 * It never stores or returns the source bytes.
 */
export async function processCatalogImageCloudflare(
  input: Uint8Array,
  images: CatalogImagesBinding,
): Promise<ProcessedCatalogImage> {
  if (!input.length || input.length > MAX_BYTES)
    throw new CatalogImageError("too_large", "A imagem deve ter até 5 MB.");

  let mime: Mime;
  try {
    mime = inspectStaticImageContainer(input);
    if (mime === "image/jpeg") stripJpegMetadata(input);
  } catch {
    throw new CatalogImageError(
      "invalid",
      "Envie uma imagem JPEG, PNG ou WebP estática.",
    );
  }

  let sourceInfo: ImageInfo;
  try {
    sourceInfo = await images.info(bytesAsStream(input));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Number(error.code)
        : undefined;
    if (code === 9412)
      throw new CatalogImageError("invalid", "Arquivo de imagem inválido.");
    throw serviceError(error);
  }
  if (sourceInfo.format !== mime)
    throw new CatalogImageError("invalid", "Arquivo de imagem inválido.");
  assertDimensions(sourceInfo);

  let encoded: Uint8Array;
  try {
    const output = await images.input(bytesAsStream(input)).output({
      format: mime,
      quality: mime === "image/png" ? undefined : 88,
      anim: false,
    });
    const response = output.response();
    if (response.headers.get("content-type") !== mime)
      throw new CatalogImageServiceError("unavailable");
    encoded = await readBoundedImage(response);
  } catch (error) {
    if (error instanceof CatalogImageError || error instanceof CatalogImageServiceError)
      throw error;
    throw serviceError(error);
  }

  let sanitized: Uint8Array;
  try {
    sanitized = mime === "image/jpeg"
      ? stripJpegMetadata(encoded)
      : mime === "image/png"
        ? stripPngMetadata(encoded)
        : stripWebpMetadata(encoded);
    if (inspectStaticImageContainer(sanitized) !== mime)
      throw new Error("Unexpected image format");
  } catch {
    throw new CatalogImageServiceError("unavailable");
  }

  let outputInfo: ImageInfo;
  try {
    outputInfo = await images.info(bytesAsStream(sanitized));
  } catch (error) {
    throw serviceError(error);
  }
  if (outputInfo.format !== mime)
    throw new CatalogImageServiceError("unavailable");
  assertDimensions(outputInfo);

  return {
    bytes: Buffer.from(sanitized),
    mimeType: mime,
    width: outputInfo.width,
    height: outputInfo.height,
  };
}
