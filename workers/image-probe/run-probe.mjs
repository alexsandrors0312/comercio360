import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { inspectStaticImageContainer } from "../../lib/catalog-image/animation.ts";

const target = process.argv[2] ?? "http://127.0.0.1:8787/probe";
const MAX_BYTES = 5 * 1024 * 1024;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind, data) {
  const type = Buffer.from(kind, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function pngChunks(bytes) {
  const chunks = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    chunks.push({ kind, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (kind === "IEND") break;
  }
  return chunks;
}

async function makeApng() {
  const first = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "red" },
  }).png().toBuffer();
  const second = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "blue" },
  }).png().toBuffer();
  const a = pngChunks(first);
  const b = pngChunks(second);
  const control = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(2, 4);
    data.writeUInt32BE(2, 8);
    data.writeUInt16BE(1, 20); // 1/10 second
    data.writeUInt16BE(10, 22);
    return pngChunk("fcTL", data);
  };
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  return Buffer.concat([
    first.subarray(0, 8),
    pngChunk("IHDR", a.find((chunk) => chunk.kind === "IHDR").data),
    pngChunk("acTL", animation),
    control(0),
    ...a.filter((chunk) => chunk.kind === "IDAT").map((chunk) => pngChunk("IDAT", chunk.data)),
    control(1),
    ...b.filter((chunk) => chunk.kind === "IDAT").map((chunk) => {
      const sequence = Buffer.alloc(4);
      sequence.writeUInt32BE(2);
      return pngChunk("fdAT", Buffer.concat([sequence, chunk.data]));
    }),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeTwoFrameGif() {
  const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
  const frame = (pixel) => Buffer.from([
    0x21, 0xf9, 0x04, 0x00, 0x05, 0x00, 0x00, 0x00,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
    2, 2, pixel ? 0x4c : 0x44, 1, 0,
  ]);
  return Buffer.concat([header, frame(0), frame(1), Buffer.from([0x3b])]);
}

async function makeFixtures() {
  const pixels = Buffer.alloc(48 * 32 * 3);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 48; x++) {
      const offset = (y * 48 + x) * 3;
      pixels[offset] = x < 24 ? 240 : 15;
      pixels[offset + 1] = y < 16 ? 200 : 10;
      pixels[offset + 2] = x >= 24 ? 240 : 15;
    }
  }
  const image = () => sharp(pixels, { raw: { width: 48, height: 32, channels: 3 } });
  const jpeg = await image().jpeg().withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Copyright: "private synthetic metadata" } }).toBuffer();
  const basicPng = await image().png()
    .withExif({ IFD0: { Copyright: "private synthetic metadata" } })
    .withXmp("<xmpmeta>private synthetic metadata</xmpmeta>")
    .withIccProfile("srgb").toBuffer();
  const png = Buffer.concat([
    basicPng.subarray(0, 33),
    pngChunk("tEXt", Buffer.from("Comment\0private synthetic text")),
    pngChunk("iTXt", Buffer.from("Comment\0\0\0\0\0private synthetic international text")),
    pngChunk("zTXt", Buffer.concat([
      Buffer.from("Comment\0\0"), deflateSync(Buffer.from("private synthetic compressed text")),
    ])),
    basicPng.subarray(33),
  ]);
  const webp = await image().webp()
    .withExif({ IFD0: { Copyright: "private synthetic metadata" } })
    .withXmp("<xmpmeta>private synthetic metadata</xmpmeta>")
    .withIccProfile("srgb").toBuffer();
  for (const source of [png, webp]) {
    const metadata = await sharp(source).metadata();
    assert.ok(metadata.exif && metadata.xmp && metadata.icc,
      "PNG/WebP fixture must contain EXIF, XMP and ICC");
  }
  const apng = await makeApng();
  const animatedWebp = await sharp(makeTwoFrameGif(), { animated: true })
    .webp({ loop: 0 }).toBuffer();
  const wide = await sharp({
    create: { width: 10_001, height: 1, channels: 3, background: "white" },
  }).png().toBuffer();
  return [
    { name: "jpeg_exif_orientation", bytes: jpeg, mime: "image/jpeg", width: 32, height: 48 },
    { name: "png_static", bytes: png, mime: "image/png", width: 48, height: 32 },
    { name: "webp_static", bytes: webp, mime: "image/webp", width: 48, height: 32 },
    { name: "apng_animated", bytes: apng, reject: 415 },
    { name: "webp_animated", bytes: animatedWebp, reject: 415 },
    { name: "png_wide", bytes: wide, reject: 422 },
    { name: "jpeg_malformed", bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00]), reject: 415 },
    { name: "oversized", bytes: Buffer.alloc(MAX_BYTES + 1), reject: 413 },
  ];
}

async function main() {
  const fixtures = await makeFixtures();
  const results = [];
  for (const fixture of fixtures) {
    if (fixture.name === "apng_animated" || fixture.name === "webp_animated") {
      assert.throws(() => inspectStaticImageContainer(fixture.bytes));
      const metadata = await sharp(fixture.bytes, { animated: true }).metadata();
      if (fixture.name === "webp_animated")
        assert.ok((metadata.pages ?? 1) > 1, "animated WebP must have two frames");
      else {
        // sharp/libvips decodes APNG's default frame but does not report APNG
        // page count. The generated container includes acTL/fcTL/fdAT with
        // valid CRCs; our parser rejects those chunks before the binding.
        assert.equal(metadata.format, "png");
        assert.ok(Buffer.from(fixture.bytes).includes(Buffer.from("acTL")));
        assert.ok(Buffer.from(fixture.bytes).includes(Buffer.from("fdAT")));
      }
    }
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: fixture.bytes,
    });
    assert.equal(response.status, fixture.reject ?? 200, fixture.name);
    if (fixture.reject) {
      await response.arrayBuffer();
      results.push({ case: fixture.name, status: response.status, result: "PASS" });
      continue;
    }
    assert.equal(response.headers.get("content-type"), fixture.mime, fixture.name);
    const output = Buffer.from(await response.arrayBuffer());
    assert.ok(output.length > 0 && output.length <= MAX_BYTES, fixture.name);
    assert.equal(inspectStaticImageContainer(output), fixture.mime, fixture.name);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, fixture.mime.split("/")[1], fixture.name);
    assert.equal(metadata.width, fixture.width, fixture.name);
    assert.equal(metadata.height, fixture.height, fixture.name);
    assert.equal(metadata.pages ?? 1, 1, fixture.name);
    assert.equal(Number(response.headers.get("x-probe-output-width")), fixture.width, fixture.name);
    assert.equal(Number(response.headers.get("x-probe-output-height")), fixture.height, fixture.name);
    assert.ok(!metadata.exif, `${fixture.name} retained EXIF`);
    assert.ok(!metadata.orientation, `${fixture.name} retained orientation`);
    assert.ok(!metadata.xmp, `${fixture.name} retained XMP`);
    assert.ok(!metadata.iptc, `${fixture.name} retained IPTC`);
    if (fixture.mime === "image/png") {
      const kinds = pngChunks(output).map((chunk) => chunk.kind);
      for (const privateKind of ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "tIME"])
        assert.ok(!kinds.includes(privateKind), `${fixture.name} retained ${privateKind}`);
    }
    if (fixture.mime === "image/webp") {
      for (const marker of ["EXIF", "XMP ", "ICCP"])
        assert.ok(!output.includes(Buffer.from(marker)), `${fixture.name} retained ${marker}`);
    }
    if (fixture.name === "jpeg_exif_orientation") {
      const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
      const sample = (x, y) => {
        const offset = (y * info.width + x) * info.channels;
        return [data[offset], data[offset + 1], data[offset + 2]];
      };
      const topLeft = sample(4, 4);
      const topRight = sample(27, 4);
      const bottomLeft = sample(4, 43);
      const bottomRight = sample(27, 43);
      assert.ok(topLeft[0] > 140 && topLeft[1] < 100 && topLeft[2] < 100);
      assert.ok(topRight[0] > 140 && topRight[1] > 120 && topRight[2] < 100);
      assert.ok(bottomLeft[0] < 100 && bottomLeft[1] < 100 && bottomLeft[2] > 140);
      assert.ok(bottomRight[0] < 100 && bottomRight[1] > 120 && bottomRight[2] > 140);
    }
    results.push({
      case: fixture.name,
      status: response.status,
      width: metadata.width,
      height: metadata.height,
      exifAbsent: true,
      result: "PASS",
    });
  }
  process.stdout.write(`${JSON.stringify({ results })}\n`);
}

main().catch((error) => {
  process.stderr.write(`Probe FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
