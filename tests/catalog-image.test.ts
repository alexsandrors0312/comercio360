import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  CatalogImageError,
  processCatalogImage,
} from "../lib/catalog-image/process";

describe("catalog cover processing", () => {
  it("decodes, reencodes and strips source metadata before storing", async () => {
    const original = await sharp({
      create: {
        width: 48,
        height: 32,
        channels: 3,
        background: "#28804f",
      },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "private source metadata" } })
      .toBuffer();
    const result = await processCatalogImage(original);
    const metadata = await sharp(result.bytes).metadata();
    expect(result.mimeType).toBe("image/jpeg");
    expect([result.width, result.height]).toEqual([48, 32]);
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects unsupported, malformed, oversized and extreme dimensions", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    );
    await expect(processCatalogImage(svg)).rejects.toMatchObject({
      code: "invalid",
    } satisfies Partial<CatalogImageError>);
    await expect(
      processCatalogImage(Buffer.from("not an image")),
    ).rejects.toMatchObject({
      code: "invalid",
    } satisfies Partial<CatalogImageError>);
    await expect(
      processCatalogImage(Buffer.alloc(5 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({
      code: "too_large",
    } satisfies Partial<CatalogImageError>);
    const wide = await sharp({
      create: {
        width: 10_001,
        height: 1,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    await expect(processCatalogImage(wide)).rejects.toMatchObject({
      code: "dimensions",
    } satisfies Partial<CatalogImageError>);
  });

  it("bounds multipart bytes before parsing, including requests without Content-Length", async () => {
    const { readBoundedMultipart } = await import("../lib/catalog-image/form");
    const form = new FormData();
    form.set(
      "file",
      new File([Buffer.from("small")], "small.png", { type: "image/png" }),
    );
    const normal = new Request("http://localhost/upload", {
      method: "POST",
      body: form,
    });
    expect(normal.headers.get("content-length")).toBeNull();
    const parsed = await readBoundedMultipart(normal, 1024);
    expect((parsed.get("file") as File).size).toBe(5);

    const oversized = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: new Blob([Buffer.alloc(2048)]),
    });
    await expect(readBoundedMultipart(oversized, 1024)).rejects.toMatchObject({
      code: "too_large",
    });
  });
});
