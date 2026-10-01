import { createHmac } from "node:crypto";

export type CatalogImageAttestation = {
  organizationId: string;
  storeId: string;
  productId: string;
  objectId: string;
  actorUserId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  sha256Hex: string;
  expiresUnix: number;
};

export function catalogImageAttestationPayload(
  value: CatalogImageAttestation,
): string {
  return [
    "catalog-image-v1",
    value.organizationId,
    value.storeId,
    value.productId,
    value.objectId,
    value.actorUserId,
    value.mimeType,
    String(value.byteSize),
    String(value.width),
    String(value.height),
    value.sha256Hex,
    String(value.expiresUnix),
  ].join("|");
}

export function parseCatalogImageKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("Image attestation key unavailable");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("Image attestation key unavailable");
  }
  return key;
}

export function signCatalogImageAttestation(
  value: CatalogImageAttestation,
  key: Uint8Array,
): string {
  if (key.length !== 32) throw new Error("Image attestation key unavailable");
  return createHmac("sha256", key)
    .update(catalogImageAttestationPayload(value), "utf8")
    .digest("hex");
}
