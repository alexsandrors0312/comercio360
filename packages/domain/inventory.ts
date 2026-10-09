/** Pure inventory rules. Quantities are whole units; revisions stay exact strings. */
export const MAX_MOVEMENT_QUANTITY = 1_000_000;
export const MAX_STOCK_QUANTITY = 2_147_483_647;
const MAX_REVISION = 9_223_372_036_854_775_807n;

export function parseInventoryQuantity(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  const quantity = Number(text);
  return quantity >= 1 && quantity <= MAX_MOVEMENT_QUANTITY ? quantity : null;
}

export function parseInventoryRevision(value: string): string | null {
  if (value.length > 19 || !/^(0|[1-9]\d*)$/.test(value)) return null;
  return BigInt(value) <= MAX_REVISION ? value : null;
}

export function normalizeInventoryReason(value: string): string {
  return value.trim();
}
