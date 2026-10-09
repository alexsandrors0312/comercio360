import { describe, expect, it } from "vitest";
import {
  calculatePurchaseTotal,
  formatPurchaseMoney,
  parsePurchaseUnitCost,
} from "../packages/domain/procurement";
import {
  procurementSupplierSchema,
  purchaseOrderSchema,
  purchaseTransitionSchema,
  purchaseCancelSchema,
} from "../packages/validation/procurement";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";
const supplier = {
  supplierId: id,
  name: "Fornecedor Ágil",
  contact: "",
  active: true,
  expectedRevision: "0",
  idempotencyKey: key,
};
const order = {
  supplierId: id,
  items: [{ variantId: id, quantity: "1", unitCost: "0,01" }],
  idempotencyKey: key,
};

describe("Compras: dinheiro inteiro e limites comerciais", () => {
  it("converte custo decimal em centavos exatos, sem arredondamento", () => {
    expect(parsePurchaseUnitCost("0,01")).toBe(1);
    expect(parsePurchaseUnitCost(" 19,9 ")).toBe(1990);
    expect(parsePurchaseUnitCost("19.99")).toBe(1999);
    expect(parsePurchaseUnitCost("1000000,00")).toBe(100_000_000);
    expect(parsePurchaseUnitCost("0000001,01")).toBe(101);
    expect(formatPurchaseMoney(1)).toBe("R$ 0,01");
    expect(formatPurchaseMoney(100_000_000_000)).toBe("R$ 1.000.000.000,00");
  });
  it.each([
    "",
    "0",
    "0,00",
    "-1",
    "+1",
    "1e3",
    "1.000,00",
    "1,234",
    "1.234",
    "R$ 1",
    "1 000",
    ".01",
    "1000000,01",
    "10000000",
    "Infinity",
  ])("recusa custo inválido %j", (value) =>
    expect(parsePurchaseUnitCost(value)).toBeNull(),
  );
  it("calcula limite agregado e recusa uma linha ou total inválidos", () => {
    expect(
      calculatePurchaseTotal([{ quantity: 1_000_000, unitCostCents: 100_000 }]),
    ).toBe(100_000_000_000);
    expect(
      calculatePurchaseTotal([{ quantity: 1_000_000, unitCostCents: 100_001 }]),
    ).toBeNull();
    expect(
      calculatePurchaseTotal([
        { quantity: 500_000, unitCostCents: 100_000 },
        { quantity: 500_001, unitCostCents: 100_000 },
      ]),
    ).toBeNull();
    for (const items of [
      [],
      [{ quantity: 0, unitCostCents: 1 }],
      [{ quantity: 1.5, unitCostCents: 1 }],
      [{ quantity: 1, unitCostCents: 0 }],
      [{ quantity: 1, unitCostCents: 100_000_001 }],
      [{ quantity: 1_000_001, unitCostCents: 1 }],
      [{ quantity: 1, unitCostCents: NaN }],
      Array.from({ length: 51 }, () => ({ quantity: 1, unitCostCents: 1 })),
    ])
      expect(calculatePurchaseTotal(items)).toBeNull();
  });
  it("normaliza fornecedor Unicode e limita contato sem inventar validação fiscal", () => {
    expect(
      procurementSupplierSchema.parse({
        ...supplier,
        name: "  👕Ágil  ",
        contact: "  Whatsapp livre  ",
      }),
    ).toEqual({ ...supplier, name: "👕Ágil", contact: "Whatsapp livre" });
    expect(
      procurementSupplierSchema.safeParse({
        ...supplier,
        name: "👕".repeat(120),
        contact: "👕".repeat(160),
      }).success,
    ).toBe(true);
    for (const input of [
      { ...supplier, name: "ab" },
      { ...supplier, name: "a\0b" },
      { ...supplier, name: "👕".repeat(121) },
      { ...supplier, contact: "👕".repeat(161) },
      { ...supplier, expectedRevision: "00" },
      { ...supplier, active: "true" },
      { ...supplier, supplierId: "qualquer" },
    ])
      expect(procurementSupplierSchema.safeParse(input).success).toBe(false);
  });
  it("transforma linhas e rejeita duplicatas inclusive UUID em caixa diferente", () => {
    expect(purchaseOrderSchema.parse(order)).toEqual({
      ...order,
      items: [{ variantId: id, quantity: 1, unitCostCents: 1 }],
    });
    const variant = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    expect(
      purchaseOrderSchema.safeParse({
        ...order,
        items: [
          { ...order.items[0], variantId: variant },
          { ...order.items[0], variantId: variant.toUpperCase() },
        ],
      }).success,
    ).toBe(false);
    for (const items of [
      [],
      Array(51).fill(order.items[0]),
      [{ ...order.items[0], quantity: "1e2" }],
      [{ ...order.items[0], quantity: "1000000", unitCost: "1000000" }],
    ])
      expect(purchaseOrderSchema.safeParse({ ...order, items }).success).toBe(
        false,
      );
    const items = Array.from({ length: 50 }, (_, index) => ({
      ...order.items[0],
      variantId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    expect(purchaseOrderSchema.safeParse({ ...order, items }).success).toBe(
      true,
    );
  });
  it("mantém revisões exatas e exige motivo Unicode no cancelamento", () => {
    const input = {
      orderId: id,
      expectedRevision: "9223372036854775807",
      idempotencyKey: key,
    };
    expect(purchaseTransitionSchema.parse(input)).toEqual(input);
    expect(
      purchaseTransitionSchema.safeParse({ ...input, expectedRevision: "0" })
        .success,
    ).toBe(false);
    expect(
      purchaseCancelSchema.parse({ ...input, reason: "  👕👕👕  " }).reason,
    ).toBe("👕👕👕");
    for (const reason of ["  ", "ab", "a\0b", "👕".repeat(241)])
      expect(purchaseCancelSchema.safeParse({ ...input, reason }).success).toBe(
        false,
      );
    expect(
      purchaseTransitionSchema.safeParse({
        ...input,
        expectedRevision: "9223372036854775808",
      }).success,
    ).toBe(false);
  });
});
