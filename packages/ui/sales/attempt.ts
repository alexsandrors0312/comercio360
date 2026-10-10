import { z } from "zod";
import { saleSchema, saleCancelSchema } from "../../validation/sales";
import type {
  SaleInput,
  SaleCancelInput,
  SalesScope,
} from "../../domain/sales-contracts";
export type SaleAttempt =
  | { kind: "confirm"; payload: SaleInput }
  | { kind: "cancel"; payload: SaleCancelInput };
export type AttemptStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export function saleAttemptKey(scope: SalesScope, userId: string): string {
  return `c360:pdv:v1:${userId}:${scope.organizationId}:${scope.storeId}`;
}
export function parseSaleAttempt(value: unknown): SaleAttempt {
  const record = z
    .object({ kind: z.enum(["confirm", "cancel"]), payload: z.unknown() })
    .strict()
    .parse(value);
  if (record.kind === "confirm") {
    const raw = z
      .object({
        items: z.array(
          z
            .object({
              variantId: z.string(),
              quantity: z.string(),
              expectedUnitPriceCents: z.number(),
            })
            .strict(),
        ),
        customerId: z.uuid().nullable().optional(),
        idempotencyKey: z.string(),
      })
      .strict()
      .parse(record.payload);
    saleSchema.parse(raw);
    return { kind: "confirm", payload: raw };
  }
  const raw = z
    .object({
      saleId: z.string(),
      expectedRevision: z.string(),
      reason: z.string(),
      idempotencyKey: z.string(),
    })
    .strict()
    .parse(record.payload);
  saleCancelSchema.parse(raw);
  return { kind: "cancel", payload: raw };
}
export function loadSaleAttempt(
  storage: AttemptStorage,
  key: string,
): SaleAttempt | null {
  const raw = storage.getItem(key);
  return raw === null ? null : parseSaleAttempt(JSON.parse(raw));
}
export function persistSaleAttempt(
  storage: AttemptStorage,
  key: string,
  attempt: SaleAttempt,
): void {
  const raw = JSON.stringify(parseSaleAttempt(attempt));
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("Attempt persistence failed");
}
export function clearSaleAttempt(storage: AttemptStorage, key: string): void {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Attempt clearing failed");
}
