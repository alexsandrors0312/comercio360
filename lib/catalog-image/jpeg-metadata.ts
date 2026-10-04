/**
 * Removes JPEG APP0–APP15 and COM segments, including segments between scans.
 * These segments carry EXIF, XMP, ICC, IPTC, comments and other side data.
 * Image tables, frame headers and entropy-coded scans are copied byte-for-byte.
 * Throws on malformed structure instead of returning an unsanitized image.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8)
    throw new Error("Invalid JPEG start");

  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let offset = 2;
  let scanCount = 0;

  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new Error("Invalid JPEG marker");
    const markerStart = offset;
    while (offset < input.length && input[offset] === 0xff) offset++;
    if (offset >= input.length) throw new Error("Truncated JPEG marker");
    const marker = input[offset++];
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      throw new Error("Invalid JPEG marker placement");
    if (marker === 0xd9) {
      if (!scanCount || offset !== input.length)
        throw new Error("Invalid JPEG end");
      parts.push(input.subarray(markerStart, offset));
      return concat(parts);
    }
    if (marker === 0x01) {
      parts.push(input.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > input.length) throw new Error("Truncated JPEG segment");
    const length = (input[offset] << 8) | input[offset + 1];
    if (length < 2 || offset + length > input.length)
      throw new Error("Invalid JPEG segment length");
    const segmentEnd = offset + length;
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(input.subarray(markerStart, segmentEnd));
    offset = segmentEnd;

    if (marker === 0xda) {
      scanCount++;
      const scanStart = offset;
      while (offset < input.length) {
        if (input[offset] !== 0xff) {
          offset++;
          continue;
        }
        let next = offset + 1;
        while (next < input.length && input[next] === 0xff) next++;
        if (next >= input.length) throw new Error("Truncated JPEG scan");
        const code = input[next];
        if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) {
          offset = next + 1;
          continue;
        }
        parts.push(input.subarray(scanStart, offset));
        break;
      }
      if (offset >= input.length) throw new Error("Missing JPEG end");
    }
  }
  throw new Error("Missing JPEG end");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((size, part) => size + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
