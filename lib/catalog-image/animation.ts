/**
 * Reject containers that declare animation before the Images binding can
 * flatten them with `anim: false`. Decoding and pixel validation remain the
 * responsibility of the image processor.
 */
export function inspectStaticImageContainer(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (pngSignature.every((value, index) => bytes[index] === value)) {
    if (bytes.length < 33) throw new Error("Invalid PNG container");
    let offset = 8;
    let first = true;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = readU32BE(bytes, offset);
      const end = offset + 12 + length;
      if (end > bytes.length || end < offset) throw new Error("Invalid PNG chunk");
      const kind = ascii(bytes, offset + 4, 4);
      if (first && (kind !== "IHDR" || length !== 13))
        throw new Error("Invalid PNG header");
      if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
        throw new Error("Animated PNG is not supported");
      if (kind === "IEND") {
        if (length !== 0 || end !== bytes.length)
          throw new Error("Invalid PNG end");
        ended = true;
        break;
      }
      offset = end;
      first = false;
    }
    if (!ended) throw new Error("Invalid PNG container");
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    if (readU32LE(bytes, 4) + 8 !== bytes.length)
      throw new Error("Invalid WebP container length");
    let offset = 12;
    let foundImage = false;
    while (offset + 8 <= bytes.length) {
      const kind = ascii(bytes, offset, 4);
      const length = readU32LE(bytes, offset + 4);
      const end = offset + 8 + length + (length & 1);
      if (end > bytes.length || end < offset) throw new Error("Invalid WebP chunk");
      if (kind === "ANIM" || kind === "ANMF")
        throw new Error("Animated WebP is not supported");
      if (kind === "VP8X") {
        if (length < 10) throw new Error("Invalid WebP extended header");
        if ((bytes[offset + 8] & 0x02) !== 0)
          throw new Error("Animated WebP is not supported");
      }
      if (kind === "VP8 " || kind === "VP8L") foundImage = true;
      offset = end;
    }
    if (offset !== bytes.length || !foundImage)
      throw new Error("Invalid WebP container");
    return "image/webp";
  }

  throw new Error("Unsupported image container");
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  );
}
