import {
  calculateSaleTotal,
  MAX_SALE_LINES,
  MAX_SALE_TOTAL_CENTS,
  MAX_SALE_UNIT_PRICE_CENTS,
} from "./sales";

/** Orders capture exact BRL cents with the same limits as the sale they create. */
export const MAX_ORDER_LINES = MAX_SALE_LINES;
export const MAX_ORDER_UNIT_PRICE_CENTS = MAX_SALE_UNIT_PRICE_CENTS;
export const MAX_ORDER_TOTAL_CENTS = MAX_SALE_TOTAL_CENTS;

export function calculateOrderTotal(
  items: readonly { quantity: number; expectedUnitPriceCents: number }[],
): number | null {
  return calculateSaleTotal(items);
}

export function canTransitionOrder(
  current: "open" | "fulfilled" | "cancelled",
  next: "fulfilled" | "cancelled",
): boolean {
  return current === "open" && (next === "fulfilled" || next === "cancelled");
}
