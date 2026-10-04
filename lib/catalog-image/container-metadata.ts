/** Remove ancillary PNG chunks that can carry user-supplied side data. */
export function stripPngMetadata(input: Uint8Array): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => input[index] === value))
    throw new Error("Invalid PNG signature");
  const parts: Uint8Array[] = [input.subarray(0, 8)];
  const retained = new Set([
    "IHDR", "PLTE", "IDAT", "IEND", // pixel data and palette
    "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", // visual interpretation
  ]);
  let offset = 8;
  let first = true;
  let imageData = false;
  while (offset + 12 <= input.length) {
    const length = readU32BE(input, offset);
    const end = offset + 12 + length;
    if (end > input.length) throw new Error("Invalid PNG chunk length");
    const kind = ascii(input, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(kind)) throw new Error("Invalid PNG chunk type");
    if (first && (kind !== "IHDR" || length !== 13))
      throw new Error("Invalid PNG header");
    if (kind === "acTL" || kind === "fcTL" || kind === "fdAT")
      throw new Error("Animated PNG is not supported");
    if (kind === "IDAT") imageData = true;
    if (retained.has(kind)) parts.push(input.subarray(offset, end));
    else if (kind.charCodeAt(0) < 97)
      throw new Error("Unknown critical PNG chunk");
    offset = end;
    first = false;
    if (kind === "IEND") {
      if (!imageData || length !== 0 || offset !== input.length)
        throw new Error("Invalid PNG end");
      return concat(parts);
    }
  }
  throw new Error("Missing PNG end");
}

/** Remove all non-pixel WebP chunks and clear their VP8X feature flags. */
export function stripWebpMetadata(input: Uint8Array): Uint8Array {
  if (
    input.length < 20 ||
    ascii(input, 0, 4) !== "RIFF" ||
    ascii(input, 8, 4) !== "WEBP" ||
    readU32LE(input, 4) + 8 !== input.length
  )
    throw new Error("Invalid WebP container");

  const parts: Uint8Array[] = [];
  let offset = 12;
  let imageData = false;
  while (offset + 8 <= input.length) {
    const kind = ascii(input, offset, 4);
    const length = readU32LE(input, offset + 4);
    const end = offset + 8 + length + (length & 1);
    if (end > input.length) throw new Error("Invalid WebP chunk length");
    if (kind === "ANIM" || kind === "ANMF")
      throw new Error("Animated WebP is not supported");
    if (kind === "VP8X") {
      if (length !== 10 || (input[offset + 8] & 0x02) !== 0)
        throw new Error("Invalid or animated WebP extended header");
      const header = new Uint8Array(input.subarray(offset, end));
      header[8] &= ~0x2c; // Clear ICC, EXIF and XMP feature flags.
      parts.push(header);
    } else if (kind === "VP8 " || kind === "VP8L" || kind === "ALPH") {
      if (kind === "VP8 " || kind === "VP8L") imageData = true;
      parts.push(input.subarray(offset, end));
    }
    offset = end;
  }
  if (offset !== input.length || !imageData)
    throw new Error("Invalid WebP image data");

  const result = concat([input.subarray(0, 12), ...parts]);
  const riffSize = result.length - 8;
  result[4] = riffSize & 0xff;
  result[5] = (riffSize >>> 8) & 0xff;
  result[6] = (riffSize >>> 16) & 0xff;
  result[7] = (riffSize >>> 24) & 0xff;
  return result;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
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
