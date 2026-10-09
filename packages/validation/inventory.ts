import { z } from "zod";
import {
  normalizeInventoryReason,
  parseInventoryQuantity,
  parseInventoryRevision,
} from "../domain/inventory";

export const inventoryMovementInputSchema = z.object({
  variantId: z.uuid(),
  kind: z.enum(["entry", "exit"]),
  quantity: z
    .string()
    .refine(
      (value) => parseInventoryQuantity(value) !== null,
      "Quantidade deve ser um inteiro de 1 a 1.000.000",
    )
    .transform((value) => parseInventoryQuantity(value)!),
  reason: z
    .string()
    .transform(normalizeInventoryReason)
    .refine((value) => {
      const count = Array.from(value).length;
      return count >= 3 && count <= 240 && !value.includes("\0");
    }, "Motivo deve ter de 3 a 240 caracteres"),
  expectedRevision: z
    .string()
    .refine(
      (value) => parseInventoryRevision(value) !== null,
      "Revisão inválida",
    ),
  idempotencyKey: z.uuid(),
});
