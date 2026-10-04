import { CatalogImageError } from "../../../lib/catalog-image/contracts";
import {
  CatalogImageServiceError,
  processCatalogImageCloudflare,
  type CatalogImagesBinding,
} from "../../../lib/catalog-image/process-cloudflare";

type ProbeEnv = { IMAGES: CatalogImagesBinding };

function error(status: number, code: string): Response {
  return Response.json(
    { code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

const probeWorker = {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (new URL(request.url).pathname !== "/probe" || request.method !== "POST")
      return error(404, "not_found");
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 5 * 1024 * 1024)
      return error(413, "too_large");

    try {
      const processed = await processCatalogImageCloudflare(
        new Uint8Array(await request.arrayBuffer()),
        env.IMAGES,
      );
      const body = new ArrayBuffer(processed.bytes.length);
      new Uint8Array(body).set(processed.bytes);
      return new Response(body, {
        headers: {
          "Content-Type": processed.mimeType,
          "Cache-Control": "no-store",
          "X-Probe-Output-Width": String(processed.width),
          "X-Probe-Output-Height": String(processed.height),
        },
      });
    } catch (cause) {
      if (cause instanceof CatalogImageError) {
        return error(
          cause.code === "too_large" ? 413 : cause.code === "dimensions" ? 422 : 415,
          cause.code,
        );
      }
      if (cause instanceof CatalogImageServiceError)
        return error(503, cause.code === "quota" ? "images_quota" : "images_failure");
      return error(503, "images_failure");
    }
  },
};

export default probeWorker;
