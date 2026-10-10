import { describe, expect, it } from "vitest";
import {
  calculateSaleTotal,
  formatSaleMoney,
  MAX_SALE_TOTAL_CENTS,
  MAX_SALE_UNIT_PRICE_CENTS,
} from "../packages/domain/sales";
import { saleSchema, saleCancelSchema } from "../packages/validation/sales";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  id2 = "bbbbbbbb-0000-4000-8000-000000000001";
const line = { variantId: id, quantity: "2", expectedUnitPriceCents: 1234 };
const input = { items: [line], idempotencyKey: id2 };
describe("PDV 005 pure amounts and validation", () => {
  it("accepts zero and exact cents", () => {
    expect(
      calculateSaleTotal([{ quantity: 1, expectedUnitPriceCents: 0 }]),
    ).toBe(0);
    expect(
      calculateSaleTotal([{ quantity: 3, expectedUnitPriceCents: 1234 }]),
    ).toBe(3702);
    expect(formatSaleMoney(3702)).toBe("R$ 37,02");
  });
  it("accepts unit and total ceilings exactly", () => {
    expect(
      calculateSaleTotal([
        { quantity: 1, expectedUnitPriceCents: MAX_SALE_UNIT_PRICE_CENTS },
        { quantity: 1, expectedUnitPriceCents: 1 },
      ]),
    ).toBe(MAX_SALE_TOTAL_CENTS);
  });
  it("rejects overflow with exact huge intermediate and sum", () => {
    expect(
      calculateSaleTotal([
        {
          quantity: 1_000_000,
          expectedUnitPriceCents: MAX_SALE_UNIT_PRICE_CENTS,
        },
      ]),
    ).toBeNull();
    expect(
      calculateSaleTotal([
        { quantity: 1, expectedUnitPriceCents: MAX_SALE_UNIT_PRICE_CENTS },
        { quantity: 1, expectedUnitPriceCents: 2 },
      ]),
    ).toBeNull();
  });
  it.each([-1, 0, 1.5, 1_000_001, NaN, Infinity])(
    "rejects quantity %s",
    (quantity) =>
      expect(
        calculateSaleTotal([{ quantity, expectedUnitPriceCents: 0 }]),
      ).toBeNull(),
  );
  it.each([-1, 0.5, 1_000_000_000_000, NaN, Infinity])(
    "rejects price %s",
    (expectedUnitPriceCents) =>
      expect(
        calculateSaleTotal([{ quantity: 1, expectedUnitPriceCents }]),
      ).toBeNull(),
  );
  it("normalizes uppercase UUID, quantity and ordered payload", () => {
    const parsed = saleSchema.parse({
      ...input,
      items: [
        { ...line, variantId: id2.toUpperCase() },
        { ...line, variantId: id.toUpperCase(), quantity: " 000002 " },
      ],
    });
    expect(parsed.items.map((i) => i.variantId)).toEqual([id, id2]);
    expect(parsed.items[0].quantity).toBe(2);
  });
  it("rejects case-insensitive duplicates", () =>
    expect(
      saleSchema.safeParse({
        ...input,
        items: [line, { ...line, variantId: id.toUpperCase() }],
      }).success,
    ).toBe(false));
  it("keeps missing/null price distinct from valid zero", () => {
    expect(
      saleSchema.safeParse({
        ...input,
        items: [{ ...line, expectedUnitPriceCents: 0 }],
      }).success,
    ).toBe(true);
    for (const price of [undefined, null, "0"]) {
      expect(
        saleSchema.safeParse({
          ...input,
          items: [{ ...line, expectedUnitPriceCents: price }],
        }).success,
      ).toBe(false);
    }
  });
  it("limits line count and quantity input", () => {
    expect(calculateSaleTotal([])).toBeNull();
    expect(
      calculateSaleTotal(
        Array(51).fill({ quantity: 1, expectedUnitPriceCents: 0 }),
      ),
    ).toBeNull();
    for (const quantity of ["0", "1.1", "1e2", "1000001", "-1", ""]) {
      expect(
        saleSchema.safeParse({ ...input, items: [{ ...line, quantity }] })
          .success,
      ).toBe(false);
    }
  });
  it("normalizes Unicode reason and preserves exact positive bigint revision", () => {
    expect(
      saleCancelSchema.parse({
        saleId: id,
        expectedRevision: "9223372036854775807",
        reason: "\u00a0👕👕👕\ufeff",
        idempotencyKey: id2,
      }),
    ).toMatchObject({
      reason: "👕👕👕",
      expectedRevision: "9223372036854775807",
    });
  });
  it("rejects invalid revision and reason boundaries", () => {
    const cancel = {
      saleId: id,
      expectedRevision: "1",
      reason: "Retorno integral",
      idempotencyKey: id2,
    };
    for (const expectedRevision of [
      "0",
      "01",
      "-1",
      "1.0",
      "9223372036854775808",
    ]) {
      expect(
        saleCancelSchema.safeParse({ ...cancel, expectedRevision }).success,
      ).toBe(false);
    }
    for (const reason of ["  ab  ", "👕".repeat(241), "a\0b"]) {
      expect(saleCancelSchema.safeParse({ ...cancel, reason }).success).toBe(
        false,
      );
    }
    expect(
      saleCancelSchema.safeParse({ ...cancel, reason: "👕".repeat(240) })
        .success,
    ).toBe(true);
  });
});
