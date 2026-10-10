import { z } from "zod";
import {
  parseInventoryQuantity,
  parseInventoryRevision,
  normalizeInventoryReason,
} from "../domain/inventory";
import {
  calculateSaleTotal,
  MAX_SALE_LINES,
  MAX_SALE_UNIT_PRICE_CENTS,
} from "../domain/sales";
const uuid = z.uuid().transform((value) => value.toLowerCase());
export const saleSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: uuid,
        quantity: z
          .string()
          .refine(
            (value) => parseInventoryQuantity(value) !== null,
            "Quantidade deve ser um inteiro de 1 a 1.000.000",
          )
          .transform((value) => parseInventoryQuantity(value)!),
        expectedUnitPriceCents: z
          .number()
          .int()
          .min(0)
          .max(MAX_SALE_UNIT_PRICE_CENTS),
      }),
    )
    .min(1, "Adicione pelo menos uma variante")
    .max(MAX_SALE_LINES, "Use até 50 variantes")
    .refine(
      (items) =>
        new Set(items.map((item) => item.variantId)).size === items.length,
      "Variantes não podem se repetir",
    )
    .refine(
      (items) => calculateSaleTotal(items) !== null,
      "Total da venda excede o limite permitido",
    )
    .transform((items) =>
      [...items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    ),
  idempotencyKey: uuid,
  customerId: uuid.nullish(),
});
export const saleCancelSchema = z.object({
  saleId: uuid,
  expectedRevision: z
    .string()
    .refine(
      (value) => value !== "0" && parseInventoryRevision(value) !== null,
      "Revisão inválida",
    ),
  reason: z
    .string()
    .transform(normalizeInventoryReason)
    .refine((value) => {
      const count = Array.from(value).length;
      return count >= 3 && count <= 240 && !value.includes("\0");
    }, "Motivo deve ter de 3 a 240 caracteres"),
  idempotencyKey: uuid,
});
