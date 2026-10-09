import { z } from "zod";
import {
  parseInventoryQuantity,
  parseInventoryRevision,
  normalizeInventoryReason,
} from "../domain/inventory";
import {
  MAX_PURCHASE_LINES,
  calculatePurchaseTotal,
  parsePurchaseUnitCost,
} from "../domain/procurement";

const textWithin = (value: string, min: number, max: number) => {
  const length = Array.from(value).length;
  return length >= min && length <= max && !value.includes("\0");
};
const revision = z
  .string()
  .refine(
    (value) => parseInventoryRevision(value) !== null,
    "Revisão inválida",
  );
export const procurementSupplierSchema = z.object({
  supplierId: z.uuid(),
  name: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => textWithin(value, 3, 120),
      "Nome deve ter de 3 a 120 caracteres",
    ),
  contact: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => textWithin(value, 0, 160),
      "Contato deve ter até 160 caracteres",
    ),
  active: z.boolean(),
  expectedRevision: revision,
  idempotencyKey: z.uuid(),
});
const purchaseLine = z
  .object({
    variantId: z.uuid(),
    quantity: z
      .string()
      .refine(
        (value) => parseInventoryQuantity(value) !== null,
        "Quantidade deve ser um inteiro de 1 a 1.000.000",
      )
      .transform((value) => parseInventoryQuantity(value)!),
    unitCost: z
      .string()
      .refine(
        (value) => parsePurchaseUnitCost(value) !== null,
        "Custo deve ser de R$ 0,01 a R$ 1.000.000,00",
      )
      .transform((value) => parsePurchaseUnitCost(value)!),
  })
  .transform(({ variantId, quantity, unitCost }) => ({
    variantId,
    quantity,
    unitCostCents: unitCost,
  }));
export const purchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  items: z
    .array(purchaseLine)
    .min(1, "Adicione pelo menos uma variante")
    .max(MAX_PURCHASE_LINES, "Use até 50 variantes")
    .refine(
      (items) =>
        new Set(items.map((item) => item.variantId.toLowerCase())).size ===
        items.length,
      "Variantes não podem se repetir",
    )
    .refine(
      (items) => calculatePurchaseTotal(items) !== null,
      "Total do pedido excede o limite permitido",
    ),
  idempotencyKey: z.uuid(),
});
export const purchaseTransitionSchema = z.object({
  orderId: z.uuid(),
  expectedRevision: revision.refine(
    (value) => value !== "0",
    "Revisão do pedido deve ser positiva",
  ),
  idempotencyKey: z.uuid(),
});
export const purchaseCancelSchema = purchaseTransitionSchema.extend({
  reason: z
    .string()
    .transform(normalizeInventoryReason)
    .refine(
      (value) => textWithin(value, 3, 240),
      "Motivo deve ter de 3 a 240 caracteres",
    ),
});
