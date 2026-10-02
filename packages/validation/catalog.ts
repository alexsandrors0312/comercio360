import { z } from "zod";
import {
  characterCount,
  normalizeBarcode,
  normalizeCategoryName,
  normalizeDescription,
  normalizeProductName,
  normalizeSku,
  normalizeVariantAttribute,
  parseBrlDecimal,
  parseCatalogRevision,
} from "../domain/catalog";

const within = (value: string, max: number) =>
  characterCount(value) > 0 &&
  characterCount(value) <= max &&
  !value.includes("\0");
const optionalWithin = (value: string | null, max: number) =>
  value === null || (characterCount(value) <= max && !value.includes("\0"));

// Category names fit the technical 120-character storage limit in ADR-0010.
export const catalogCategoryNameSchema = z
  .string()
  .transform(normalizeCategoryName)
  .refine(
    (value) => within(value, 120),
    "Nome da categoria deve ter de 1 a 120 caracteres",
  );

export const catalogProductNameSchema = z
  .string()
  .transform(normalizeProductName)
  .refine(
    (value) => within(value, 120),
    "Nome do produto deve ter de 1 a 120 caracteres",
  );

export const catalogDescriptionSchema = z
  .string()
  .nullish()
  .transform(normalizeDescription)
  .refine(
    (value) => optionalWithin(value, 2000),
    "Descrição deve ter até 2000 caracteres",
  );

export const catalogSkuSchema = z
  .string()
  .transform(normalizeSku)
  .refine((value) => within(value, 64), "SKU deve ter de 1 a 64 caracteres");

export const catalogVariantAttributeSchema = z
  .string()
  .nullish()
  .transform(normalizeVariantAttribute)
  .refine(
    (value) => optionalWithin(value, 60),
    "Cor ou tamanho deve ter até 60 caracteres",
  );

export const catalogBarcodeSchema = z
  .string()
  .nullish()
  .transform(normalizeBarcode)
  .refine(
    (value) => optionalWithin(value, 64),
    "Código de barras deve ter até 64 caracteres",
  );

export const catalogBrlPriceSchema = z
  .string()
  .refine((value) => parseBrlDecimal(value) !== null, "Preço BRL inválido")
  .transform((value) => parseBrlDecimal(value)!);

export const catalogRevisionSchema = z
  .string()
  .refine((value) => parseCatalogRevision(value) !== null, "Revisão inválida")
  .transform((value) => parseCatalogRevision(value)!);

export const catalogCategoryInputSchema = z.object({
  name: catalogCategoryNameSchema,
});

export const catalogCategoryUpdateInputSchema =
  catalogCategoryInputSchema.extend({
    active: z.boolean(),
    expectedRevision: catalogRevisionSchema,
  });

export const catalogProductInputSchema = z.object({
  name: catalogProductNameSchema,
  description: catalogDescriptionSchema,
  categoryId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
});

export const catalogProductUpdateInputSchema = catalogProductInputSchema.extend(
  {
    active: z.boolean(),
    expectedRevision: catalogRevisionSchema,
  },
);

export const catalogVariantInputSchema = z.object({
  sku: catalogSkuSchema,
  color: catalogVariantAttributeSchema,
  size: catalogVariantAttributeSchema,
  unit: z.literal("UN").default("UN"),
  barcode: catalogBarcodeSchema,
});

export const catalogVariantUpdateInputSchema = catalogVariantInputSchema.extend(
  {
    active: z.boolean(),
    expectedRevision: catalogRevisionSchema,
  },
);

export const catalogProductCreateInputSchema = catalogProductInputSchema.extend(
  {
    initialVariant: catalogVariantInputSchema,
    idempotencyKey: z.uuid(),
  },
);

// The store, tenant, actor and current authorization are verified by the server/database.
export const catalogPriceInputSchema = z.object({
  value: catalogBrlPriceSchema,
  expectedRevision: catalogRevisionSchema.nullable(),
});
