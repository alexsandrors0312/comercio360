import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { CatalogImageError } from "../lib/catalog-image/contracts";
import {
  CatalogImageServiceError,
  processCatalogImageCloudflare,
  type CatalogImagesBinding,
} from "../lib/catalog-image/process-cloudflare";

async function readBytes(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function responseBytes(bytes: Uint8Array, type: string) {
  const body = new ArrayBuffer(bytes.length);
  new Uint8Array(body).set(bytes);
  return new Response(body, { headers: { "Content-Type": type } });
}

function fakeBinding(): CatalogImagesBinding {
  return {
    async info(stream) {
      const bytes = await readBytes(stream);
      const metadata = await sharp(bytes).metadata();
      return {
        format: `image/${metadata.format}`,
        fileSize: bytes.length,
        width: metadata.width,
        height: metadata.height,
      };
    },
    input(stream) {
      return {
        async output(options) {
          const bytes = await readBytes(stream);
          const transformed = await sharp(bytes).rotate()
            .toFormat(options.format.split("/")[1] as "jpeg" | "png" | "webp")
            .withExif({ IFD0: { Copyright: "binding retained metadata" } })
            .withXmp("<xmpmeta>binding retained metadata</xmpmeta>")
            .withIccProfile("srgb")
            .toBuffer();
          return { response: () => responseBytes(transformed, options.format) };
        },
      };
    },
  };
}

describe("Cloudflare catalog image adapter", () => {
  it("returns reencoded JPEG with final orientation and no binding EXIF", async () => {
    const source = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#336699" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processCatalogImageCloudflare(source, fakeBinding());
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mimeType).toBe("image/jpeg");
    expect([result.width, result.height]).toEqual([32, 48]);
    expect([metadata.width, metadata.height]).toEqual([32, 48]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it.each(["png", "webp"] as const)("removes binding metadata from %s", async (format) => {
    const source = await sharp({
      create: { width: 8, height: 6, channels: 4, background: "#336699" },
    }).toFormat(format).toBuffer();
    const result = await processCatalogImageCloudflare(source, fakeBinding());
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mimeType).toBe(`image/${format}`);
    expect([result.width, result.height]).toEqual([8, 6]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects unsupported and oversized input before invoking the binding", async () => {
    const neverBinding = {
      info: () => { throw new Error("binding should not be called"); },
      input: () => { throw new Error("binding should not be called"); },
    } as unknown as CatalogImagesBinding;
    await expect(processCatalogImageCloudflare(Buffer.from("GIF89a"), neverBinding))
      .rejects.toMatchObject({ code: "invalid" } satisfies Partial<CatalogImageError>);
    await expect(processCatalogImageCloudflare(Buffer.alloc(5 * 1024 * 1024 + 1), neverBinding))
      .rejects.toMatchObject({ code: "too_large" } satisfies Partial<CatalogImageError>);
    await expect(processCatalogImageCloudflare(Buffer.from([0xff, 0xd8, 0xff, 0x00]), neverBinding))
      .rejects.toMatchObject({ code: "invalid" } satisfies Partial<CatalogImageError>);
  });

  it("reports binding quota distinctly from invalid input", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    }).png().toBuffer();
    const binding = fakeBinding();
    binding.input = () => ({
      output: async () => { throw Object.assign(new Error("quota"), { code: 9422 }); },
    });
    await expect(processCatalogImageCloudflare(source, binding))
      .rejects.toMatchObject({ code: "quota" } satisfies Partial<CatalogImageServiceError>);
  });

  it("fails closed on mismatched output MIME", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    }).png().toBuffer();
    const binding = fakeBinding();
    binding.input = () => ({
      output: async () => ({ response: () => responseBytes(source, "image/jpeg") }),
    });
    await expect(processCatalogImageCloudflare(source, binding))
      .rejects.toMatchObject({ code: "unavailable" } satisfies Partial<CatalogImageServiceError>);
  });

  it("bounds the encoded output stream before storing", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    }).png().toBuffer();
    const binding = fakeBinding();
    binding.input = () => ({
      output: async () => ({
        response: () => responseBytes(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"),
      }),
    });
    await expect(processCatalogImageCloudflare(source, binding))
      .rejects.toMatchObject({ code: "too_large" } satisfies Partial<CatalogImageError>);
  });
});
