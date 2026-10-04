export class CatalogImageError extends Error {
  constructor(
    public readonly code: "invalid" | "too_large" | "dimensions",
    message: string,
  ) {
    super(message);
    this.name = "CatalogImageError";
  }
}

export type ProcessedCatalogImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};
