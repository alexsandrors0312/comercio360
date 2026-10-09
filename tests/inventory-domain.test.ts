import { describe, expect, it } from "vitest";
import {
  MAX_MOVEMENT_QUANTITY,
  MAX_STOCK_QUANTITY,
  normalizeInventoryReason,
  parseInventoryQuantity,
  parseInventoryRevision,
} from "../packages/domain/inventory";
import { inventoryMovementInputSchema } from "../packages/validation/inventory";

const validInput = {
  variantId: "00000000-0000-4000-8000-000000000001",
  kind: "entry" as const,
  quantity: "1",
  reason: "Entrada inicial",
  expectedRevision: "0",
  idempotencyKey: "00000000-0000-4000-8000-000000000002",
};

describe("Estoque: unidades e revisão exatas", () => {
  it("aceita as fronteiras de quantidade, sem arredondar", () => {
    expect(MAX_MOVEMENT_QUANTITY).toBe(1_000_000);
    expect(MAX_STOCK_QUANTITY).toBe(2_147_483_647);
    expect(parseInventoryQuantity("1")).toBe(1);
    expect(parseInventoryQuantity("1000000")).toBe(1_000_000);
    expect(parseInventoryQuantity(" 12 ")).toBe(12);
    expect(parseInventoryQuantity("0000012")).toBe(12);
  });
  it.each([
    "",
    " ",
    "0",
    "000",
    "-1",
    "+1",
    "1.0",
    "1,0",
    "1e3",
    "1_000",
    "1 000",
    "1000001",
    "2147483647",
    "９",
    "00000001",
    "NaN",
    "Infinity",
  ])("recusa quantidade inválida %j", (value) => {
    expect(parseInventoryQuantity(value)).toBeNull();
    expect(
      inventoryMovementInputSchema.safeParse({ ...validInput, quantity: value })
        .success,
    ).toBe(false);
  });
  it("transporta bigint sem Number e aceita zero inicial", () => {
    for (const value of ["0", "1", "9007199254740993", "9223372036854775807"])
      expect(parseInventoryRevision(value)).toBe(value);
    for (const value of [
      "",
      " 0",
      "01",
      "00",
      "-1",
      "+1",
      "1e1",
      "1.0",
      "9223372036854775808",
      "99999999999999999999",
    ])
      expect(parseInventoryRevision(value)).toBeNull();
  });
  it("apara motivo sem perder espaços internos ou caracteres Unicode", () => {
    expect(normalizeInventoryReason(" \n  Recebido  da loja 👕\t")).toBe(
      "Recebido  da loja 👕",
    );
    expect(
      inventoryMovementInputSchema.parse({
        ...validInput,
        reason: "  👕👕👕  ",
      }).reason,
    ).toBe("👕👕👕");
    expect(
      inventoryMovementInputSchema.safeParse({
        ...validInput,
        reason: "👕".repeat(240),
      }).success,
    ).toBe(true);
    for (const reason of ["  ", "ab", "👕👕", "👕".repeat(241), "a\0b"])
      expect(
        inventoryMovementInputSchema.safeParse({ ...validInput, reason })
          .success,
      ).toBe(false);
  });
  it("valida identidade, tipo, idempotência e revisão antes de transformar", () => {
    expect(inventoryMovementInputSchema.parse(validInput)).toEqual({
      ...validInput,
      quantity: 1,
    });
    for (const input of [
      { ...validInput, variantId: "outro" },
      { ...validInput, kind: "transfer" },
      { ...validInput, quantity: 1 },
      { ...validInput, expectedRevision: "01" },
      { ...validInput, idempotencyKey: "nova" },
      { ...validInput, reason: null },
    ])
      expect(inventoryMovementInputSchema.safeParse(input).success).toBe(false);
  });
});
