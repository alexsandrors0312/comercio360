/** Pure customer normalization shared by validation and presentation. */
export function customerCharacterCount(value: string): number {
  return Array.from(value).length;
}

export function normalizeCustomerName(value: string): string {
  return value.trim();
}

/** Preserve leading zeroes; do not assume a country or region. */
export function normalizeCustomerPhone(
  value: string | null | undefined,
): string | null {
  if (value == null || value.trim() === "") return null;
  return value.replace(/[^0-9]/g, "");
}

export function normalizeCustomerEmail(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

/** SQL text does not admit NUL; the contract additionally forbids control characters. */
export function hasCustomerControl(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
