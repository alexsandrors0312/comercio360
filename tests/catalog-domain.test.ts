import { describe, expect, it } from "vitest";
import {
  barcodeKey,
  brlDecimalToCents,
  categoryNameKey,
  formatBrlPrice,
  normalizeCategoryName,
  parseBrlDecimal,
  parseCatalogRevision,
  skuKey,
  variantAttributeKey,
  variantCombinationKey,
} from "../packages/domain/catalog";
import {
  catalogBarcodeSchema,
  catalogBrlPriceSchema,
  catalogCategoryInputSchema,
  catalogDescriptionSchema,
  catalogProductCreateInputSchema,
  catalogProductNameSchema,
  catalogRevisionSchema,
  catalogSkuSchema,
  catalogVariantAttributeSchema,
  catalogVariantInputSchema,
} from "../packages/validation/catalog";

const validId = "10000000-0000-4000-8000-000000000001";

const isValid = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
) => schema.safeParse(value).success;

describe("catalog normalization and boundaries", () => {
  it("preserves category display accents but folds whitespace and case for its key", () => {
    expect(normalizeCategoryName("  Blusas\t  Ágeis  ")).toBe("Blusas Ágeis");
    expect(categoryNameKey("  BLUSAS   ÁGEIS  ")).toBe(
      categoryNameKey("blusas ágeis"),
    );
    expect(catalogCategoryInputSchema.parse({ name: "   Blusas  " })).toEqual({
      name: "Blusas",
    });
    expect(isValid(catalogCategoryInputSchema, { name: " \t " })).toBe(false);
    expect(isValid(catalogCategoryInputSchema, { name: "A\0B" })).toBe(false);
    expect(isValid(catalogCategoryInputSchema, { name: "c".repeat(120) })).toBe(
      true,
    );
    expect(isValid(catalogCategoryInputSchema, { name: "c".repeat(121) })).toBe(
      false,
    );
  });

  it("checks product name and optional description limits after normalization", () => {
    expect(catalogProductNameSchema.parse(` ${"a".repeat(120)} `)).toHaveLength(
      120,
    );
    expect(isValid(catalogProductNameSchema, "a".repeat(121))).toBe(false);
    expect(isValid(catalogProductNameSchema, "   ")).toBe(false);
    expect(catalogProductNameSchema.parse("👕".repeat(120))).toBe(
      "👕".repeat(120),
    );
    expect(isValid(catalogProductNameSchema, "👕".repeat(121))).toBe(false);
    expect(catalogDescriptionSchema.parse("  ")).toBeNull();
    expect(catalogDescriptionSchema.parse("x".repeat(2000))).toHaveLength(2000);
    expect(isValid(catalogDescriptionSchema, "x".repeat(2001))).toBe(false);
  });

  it("normalizes SKU and attributes, retaining exact barcode text and zeroes", () => {
    expect(catalogSkuSchema.parse("  sku-A  ")).toBe("sku-A");
    expect(skuKey("  SKU-a ")).toBe(skuKey("sku-A"));
    expect(isValid(catalogSkuSchema, "s".repeat(64))).toBe(true);
    expect(isValid(catalogSkuSchema, "s".repeat(65))).toBe(false);
    expect(isValid(catalogSkuSchema, "  ")).toBe(false);
    expect(catalogVariantAttributeSchema.parse("  ")).toBeNull();
    expect(variantAttributeKey(" Azul ")).toBe(variantAttributeKey("azul"));
    expect(variantAttributeKey(null)).toBeNull();
    expect(variantCombinationKey(validId, " Azul ", null)).toBe(
      variantCombinationKey(validId, "azul", "  "),
    );
    expect(variantCombinationKey(validId, "azul", "P")).not.toBe(
      variantCombinationKey(validId, "azul", "M"),
    );
    expect(isValid(catalogVariantAttributeSchema, "c".repeat(60))).toBe(true);
    expect(isValid(catalogVariantAttributeSchema, "c".repeat(61))).toBe(false);
    expect(catalogBarcodeSchema.parse(" 001234 ")).toBe("001234");
    expect(barcodeKey(" 001234 ")).toBe("001234");
    expect(barcodeKey("Ab")).not.toBe(barcodeKey("ab"));
    expect(isValid(catalogBarcodeSchema, "0".repeat(64))).toBe(true);
    expect(isValid(catalogBarcodeSchema, "0".repeat(65))).toBe(false);
  });

  it("requires the first-cycle unit UN and accepts an uncolored, unsized variant", () => {
    expect(catalogVariantInputSchema.parse({ sku: "BAS-01" })).toEqual({
      sku: "BAS-01",
      color: null,
      size: null,
      unit: "UN",
      barcode: null,
    });
    expect(
      isValid(catalogVariantInputSchema, { sku: "BAS-01", unit: "KG" }),
    ).toBe(false);
  });

  it("validates atomic product creation and idempotency key", () => {
    const input = {
      name: " Camiseta básica ",
      description: " ",
      categoryId: null,
      initialVariant: { sku: " AZ-P ", color: " Azul ", size: " P " },
      idempotencyKey: validId,
    };
    expect(catalogProductCreateInputSchema.parse(input)).toMatchObject({
      name: "Camiseta básica",
      description: null,
      initialVariant: { sku: "AZ-P", color: "Azul", size: "P", unit: "UN" },
    });
    expect(
      isValid(catalogProductCreateInputSchema, {
        ...input,
        idempotencyKey: "retry",
      }),
    ).toBe(false);
  });
});

describe("exact BRL prices and revisions", () => {
  it("normalizes decimal text without floating point and distinguishes missing from zero", () => {
    expect(parseBrlDecimal(" 59,90 ")).toBe("59.90");
    expect(parseBrlDecimal("59.9")).toBe("59.90");
    expect(parseBrlDecimal("00059,90")).toBe("59.90");
    expect(parseBrlDecimal("0")).toBe("0.00");
    expect(brlDecimalToCents("59,90")).toBe(5990n);
    expect(brlDecimalToCents("0")).toBe(0n);
    expect(formatBrlPrice(null)).toBe("Sem preço");
    expect(formatBrlPrice("9999999999.99")).toBe("R$ 9.999.999.999,99");
    expect(catalogBrlPriceSchema.parse(" 1,23 ")).toBe("1.23");
  });

  it("aligns the input maximum with numeric(12,2) and rejects ambiguous values", () => {
    expect(parseBrlDecimal("9999999999.99")).toBe("9999999999.99");
    for (const value of [
      "10000000000",
      "00000000001",
      "9999999999.999",
      "-1",
      "+1",
      "1e2",
      "1.234,56",
      "R$ 1,00",
      "1 2",
      "1.",
      ".50",
      "",
      " ",
    ]) {
      expect(parseBrlDecimal(value), value).toBeNull();
      expect(isValid(catalogBrlPriceSchema, value), value).toBe(false);
    }
  });

  it("transports PostgreSQL bigint revisions as bounded decimal strings", () => {
    expect(parseCatalogRevision("9223372036854775807")).toBe(
      "9223372036854775807",
    );
    for (const value of ["0", "01", "-1", "1.5", "9223372036854775808", "x"]) {
      expect(isValid(catalogRevisionSchema, value), value).toBe(false);
    }
  });
});
