import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import { stripPngMetadata, stripWebpMetadata } from "../lib/catalog-image/container-metadata";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind: string, data: Buffer) {
  const type = Buffer.from(kind);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

describe("PNG and WebP metadata sanitizer", () => {
  it("removes textual, EXIF, XMP and ICC side data from PNG while retaining pixels", async () => {
    const source = await sharp({
      create: { width: 8, height: 6, channels: 4, background: "#4488cc" },
    }).png()
      .withExif({ IFD0: { Copyright: "private synthetic metadata" } })
      .withXmp("<xmpmeta>private synthetic metadata</xmpmeta>")
      .withIccProfile("srgb")
      .toBuffer();
    const withText = Buffer.concat([
      source.subarray(0, 33),
      pngChunk("tEXt", Buffer.from("Comment\0private synthetic text")),
      pngChunk("iTXt", Buffer.from("Comment\0\0\0\0\0private synthetic text")),
      pngChunk("zTXt", Buffer.concat([
        Buffer.from("Comment\0\0"), deflateSync(Buffer.from("private synthetic text")),
      ])),
      source.subarray(33),
    ]);
    const sanitized = stripPngMetadata(withText);
    const metadata = await sharp(sanitized).metadata();
    expect(metadata.format).toBe("png");
    expect([metadata.width, metadata.height]).toEqual([8, 6]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    for (const kind of ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP"])
      expect(Buffer.from(sanitized).includes(Buffer.from(kind))).toBe(false);
    expect(await sharp(sanitized).raw().toBuffer())
      .toEqual(await sharp(source).raw().toBuffer());
  });

  it("removes EXIF, XMP and ICC chunks from static WebP", async () => {
    const source = await sharp({
      create: { width: 8, height: 6, channels: 4, background: "#4488cc" },
    }).webp()
      .withExif({ IFD0: { Copyright: "private synthetic metadata" } })
      .withXmp("<xmpmeta>private synthetic metadata</xmpmeta>")
      .withIccProfile("srgb")
      .toBuffer();
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.xmp).toBeDefined();
    expect(sourceMetadata.icc).toBeDefined();
    const sanitized = stripWebpMetadata(source);
    const metadata = await sharp(sanitized).metadata();
    expect(metadata.format).toBe("webp");
    expect([metadata.width, metadata.height]).toEqual([8, 6]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    for (const kind of ["EXIF", "XMP ", "ICCP"])
      expect(Buffer.from(sanitized).includes(Buffer.from(kind))).toBe(false);
    expect(await sharp(sanitized).raw().toBuffer())
      .toEqual(await sharp(source).raw().toBuffer());
  });

  it("fails closed on truncated containers", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "red" },
    }).png().toBuffer();
    expect(() => stripPngMetadata(source.subarray(0, -1))).toThrow();
    const webp = await sharp(source).webp().toBuffer();
    expect(() => stripWebpMetadata(webp.subarray(0, -1))).toThrow();
  });
});
