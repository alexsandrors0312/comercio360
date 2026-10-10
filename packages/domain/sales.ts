/** Exact integer BRL cents; intermediate multiplication uses BigInt. */
export const MAX_SALE_LINES = 50;
export const MAX_SALE_UNIT_PRICE_CENTS = 999_999_999_999;
export const MAX_SALE_TOTAL_CENTS = 1_000_000_000_000;
export function calculateSaleTotal(
  items: readonly { quantity: number; expectedUnitPriceCents: number }[],
): number | null {
  if (items.length < 1 || items.length > MAX_SALE_LINES) return null;
  let total = 0n;
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1_000_000 ||
      !Number.isInteger(item.expectedUnitPriceCents) ||
      item.expectedUnitPriceCents < 0 ||
      item.expectedUnitPriceCents > MAX_SALE_UNIT_PRICE_CENTS
    )
      return null;
    total += BigInt(item.quantity) * BigInt(item.expectedUnitPriceCents);
    if (total > BigInt(MAX_SALE_TOTAL_CENTS)) return null;
  }
  return Number(total);
}
export function formatSaleMoney(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${whole},${(cents % 100).toString().padStart(2, "0")}`;
}
