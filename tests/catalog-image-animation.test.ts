import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inspectStaticImageContainer } from "../lib/catalog-image/animation";

describe("catalog image container animation boundary", () => {
  it("accepts ordinary static PNG and WebP", async () => {
    const source = sharp({
      create: { width: 3, height: 2, channels: 4, background: "red" },
    });
    expect(inspectStaticImageContainer(await source.clone().png().toBuffer()))
      .toBe("image/png");
    expect(inspectStaticImageContainer(await source.clone().webp().toBuffer()))
      .toBe("image/webp");
  });

  it("rejects APNG declaration before a decoder could flatten it", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "blue" },
    }).png().toBuffer();
    const chunk = Buffer.from([
      0, 0, 0, 8, // acTL payload length
      0x61, 0x63, 0x54, 0x4c, // acTL
      0, 0, 0, 2, 0, 0, 0, 0, // two frames, infinite loop
      0, 0, 0, 0, // CRC is immaterial to pre-decode rejection
    ]);
    const animated = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    expect(() => inspectStaticImageContainer(animated)).toThrow(/Animated PNG/);
  });

  it("rejects WebP animation flag and malformed RIFF length", async () => {
    const staticWebp = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "blue" },
    }).webp().toBuffer();
    const wrongLength = Buffer.from(staticWebp);
    wrongLength.writeUInt32LE(0, 4);
    expect(() => inspectStaticImageContainer(wrongLength)).toThrow(/length/);

    const animation = Buffer.alloc(12 + 8 + 10 + 8 + 1 + 1);
    animation.write("RIFF", 0, "ascii");
    animation.writeUInt32LE(animation.length - 8, 4);
    animation.write("WEBP", 8, "ascii");
    animation.write("VP8X", 12, "ascii");
    animation.writeUInt32LE(10, 16);
    animation[20] = 0x02; // Animation feature bit
    animation.write("VP8 ", 30, "ascii");
    animation.writeUInt32LE(1, 34);
    expect(() => inspectStaticImageContainer(animation)).toThrow(/Animated WebP/);
  });
});
