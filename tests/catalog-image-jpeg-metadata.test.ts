import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { stripJpegMetadata } from "../lib/catalog-image/jpeg-metadata";

function withComment(jpeg: Uint8Array) {
  const comment = Buffer.from("private synthetic comment");
  const segment = Buffer.alloc(4 + comment.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(comment.length + 2, 2);
  comment.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

describe("JPEG binding output metadata sanitizer", () => {
  it.each([false, true])("removes EXIF and comments without damaging scans (progressive=%s)", async (progressive) => {
    const source = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#5784ba" },
    })
      .jpeg({ progressive })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "private synthetic metadata" } })
      .toBuffer();
    const sanitized = stripJpegMetadata(withComment(source));
    const metadata = await sharp(sanitized).metadata();
    expect(metadata.format).toBe("jpeg");
    expect([metadata.width, metadata.height]).toEqual([48, 32]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(Buffer.from(sanitized).includes(Buffer.from("private synthetic"))).toBe(false);
    expect(sanitized.length).toBeLessThan(source.length);
    await expect(sharp(sanitized).raw().toBuffer()).resolves.toHaveLength(48 * 32 * 3);
  });

  it("fails closed on truncated or trailing data", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    }).jpeg().toBuffer();
    expect(() => stripJpegMetadata(source.subarray(0, -2))).toThrow();
    expect(() => stripJpegMetadata(Buffer.concat([source, Buffer.from("tail")]))).toThrow();
    expect(() => stripJpegMetadata(Buffer.from("not a jpeg"))).toThrow();
  });
});
