/** Exact purchase amounts, represented as integer BRL cents. */
export const MAX_PURCHASE_LINES = 50;
export const MAX_UNIT_COST_CENTS = 100_000_000;
export const MAX_PURCHASE_TOTAL_CENTS = 100_000_000_000;

export function parsePurchaseUnitCost(value: string): number | null {
  const text = value.trim();
  const match = /^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents >= 1 && cents <= MAX_UNIT_COST_CENTS ? cents : null;
}

export function calculatePurchaseTotal(
  items: readonly { quantity: number; unitCostCents: number }[],
): number | null {
  if (items.length < 1 || items.length > MAX_PURCHASE_LINES) return null;
  let total = 0;
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 1_000_000 ||
      !Number.isInteger(item.unitCostCents) ||
      item.unitCostCents < 1 ||
      item.unitCostCents > MAX_UNIT_COST_CENTS
    )
      return null;
    total += item.quantity * item.unitCostCents;
    if (total > MAX_PURCHASE_TOTAL_CENTS) return null;
  }
  return total;
}

export function formatPurchaseMoney(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${whole},${(cents % 100).toString().padStart(2, "0")}`;
}
