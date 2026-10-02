/** Pure catalog rules shared by input validation and persistence adapters. */

const MAX_BRL_CENTS = 999_999_999_999n; // numeric(12,2): 9999999999.99
const MAX_BIGINT_REVISION = 9_223_372_036_854_775_807n;

export function characterCount(value: string): number {
  return Array.from(value).length;
}

export function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function categoryNameKey(value: string): string {
  return normalizeCategoryName(value).toLowerCase();
}

export function normalizeProductName(value: string): string {
  return value.trim();
}

export function normalizeDescription(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function normalizeSku(value: string): string {
  return value.trim();
}

export function skuKey(value: string): string {
  return normalizeSku(value).toLowerCase();
}

export function normalizeVariantAttribute(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

/** Null is a real component of the unique color/size combination. */
export function variantAttributeKey(
  value: string | null | undefined,
): string | null {
  return normalizeVariantAttribute(value)?.toLowerCase() ?? null;
}

/** A collision-free local comparison key; SQL remains the final uniqueness guard. */
export function variantCombinationKey(
  productId: string,
  color: string | null | undefined,
  size: string | null | undefined,
): string {
  return JSON.stringify([
    productId.toLowerCase(),
    variantAttributeKey(color),
    variantAttributeKey(size),
  ]);
}
export function normalizeBarcode(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

/** A barcode is exact text, including leading zeroes and case. */
export function barcodeKey(value: string | null | undefined): string | null {
  return normalizeBarcode(value);
}

/**
 * A canonical BRL decimal suitable for numeric(12,2), or null for invalid input.
 * Accepts one decimal mark (comma or dot), at most two fractional digits,
 * and no grouping mark, sign, exponent, currency symbol or whitespace inside.
 */
export function parseBrlDecimal(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;

  if (match[1].length > 10) return null;
  const significantWhole = match[1].replace(/^0+/, "") || "0";
  if (significantWhole.length > 10) return null;
  const whole = BigInt(significantWhole);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100n + fraction;
  if (cents > MAX_BRL_CENTS) return null;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Converts a validated canonical decimal to exact cents without Number. */
export function brlDecimalToCents(value: string): bigint | null {
  const canonical = parseBrlDecimal(value);
  if (canonical === null) return null;
  const [whole, fraction] = canonical.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

export function formatBrlPrice(value: string | null): string {
  if (value === null) return "Sem preço";
  const canonical = parseBrlDecimal(value);
  if (canonical === null) throw new RangeError("Invalid BRL decimal");
  const [whole, fraction] = canonical.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${fraction}`;
}

/** PostgreSQL bigint revision, transported as a decimal string. */
export function parseCatalogRevision(value: string): string | null {
  if (value.length > 19 || !/^[1-9]\d*$/.test(value)) return null;
  const revision = BigInt(value);
  if (revision > MAX_BIGINT_REVISION) return null;
  return revision.toString();
}
