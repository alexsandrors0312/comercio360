import { z } from "zod";
import {
  normalizeInventoryReason,
  parseInventoryQuantity,
  parseInventoryRevision,
} from "../domain/inventory";
import {
  calculateOrderTotal,
  MAX_ORDER_LINES,
  MAX_ORDER_UNIT_PRICE_CENTS,
} from "../domain/orders";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const revision = z
  .string()
  .refine(
    (value) => value !== "0" && parseInventoryRevision(value) !== null,
    "Revisão inválida",
  );

const item = z.strictObject({
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
    .max(MAX_ORDER_UNIT_PRICE_CENTS),
});

export const orderCreateSchema = z
  .strictObject({
    channel: z.enum(["counter", "whatsapp"]),
    customerId: uuid.nullable(),
    items: z
      .array(item)
      .min(1, "Adicione pelo menos uma variante")
      .max(MAX_ORDER_LINES, "Use até 50 variantes")
      .refine(
        (items) =>
          new Set(items.map((item) => item.variantId)).size === items.length,
        "Variantes não podem se repetir",
      )
      .refine(
        (items) => calculateOrderTotal(items) !== null,
        "Total do pedido excede o limite permitido",
      )
      .transform((items) =>
        [...items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
      ),
    idempotencyKey: uuid,
  })
  .refine(
    ({ channel, customerId }) => channel !== "whatsapp" || customerId !== null,
    "Pedido de WhatsApp exige cliente",
  );

export const orderCancelSchema = z.strictObject({
  orderId: uuid,
  expectedRevision: revision,
  reason: z
    .string()
    .transform(normalizeInventoryReason)
    .refine((value) => {
      const count = Array.from(value).length;
      return count >= 3 && count <= 240 && !value.includes("\0");
    }, "Motivo deve ter de 3 a 240 caracteres"),
  idempotencyKey: uuid,
});

export const orderFulfillSchema = z.strictObject({
  orderId: uuid,
  expectedRevision: revision,
  idempotencyKey: uuid,
});

export const orderListSchema = z.strictObject({
  status: z.enum(["all", "open", "fulfilled", "cancelled"]).default("all"),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  orderId: uuid.nullish().transform((value) => value ?? null),
});
