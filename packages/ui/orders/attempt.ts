import { z } from "zod";
import {
  orderCancelSchema,
  orderCreateSchema,
  orderFulfillSchema,
} from "../../validation/orders";
import type {
  CancelOrderInput,
  CreateOrderInput,
  FulfillOrderInput,
  OrderScope,
} from "../../domain/orders-contracts";

export type OrderAttempt =
  | { kind: "create"; payload: CreateOrderInput }
  | { kind: "cancel"; payload: CancelOrderInput }
  | { kind: "fulfill"; payload: FulfillOrderInput };
export type OrderAttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const line = z.strictObject({
  variantId: z.uuid(),
  quantity: z.string(),
  expectedUnitPriceCents: z.number(),
});
const create = z.strictObject({
  channel: z.enum(["counter", "whatsapp"]),
  customerId: z.uuid().nullable(),
  items: z.array(line),
  idempotencyKey: z.uuid(),
});
const cancel = z.strictObject({
  orderId: z.uuid(),
  expectedRevision: z.string(),
  reason: z.string(),
  idempotencyKey: z.uuid(),
});
const fulfill = z.strictObject({
  orderId: z.uuid(),
  expectedRevision: z.string(),
  idempotencyKey: z.uuid(),
});

export function orderAttemptKey(scope: OrderScope, userId: string): string {
  return `c360:pedidos:v1:${userId}:${scope.organizationId}:${scope.storeId}`;
}

export function parseOrderAttempt(value: unknown): OrderAttempt {
  const envelope = z
    .strictObject({ kind: z.enum(["create", "cancel", "fulfill"]), payload: z.unknown() })
    .parse(value);
  if (envelope.kind === "create") {
    const payload = create.parse(envelope.payload);
    orderCreateSchema.parse(payload);
    return { kind: "create", payload };
  }
  if (envelope.kind === "cancel") {
    const payload = cancel.parse(envelope.payload);
    orderCancelSchema.parse(payload);
    return { kind: "cancel", payload };
  }
  const payload = fulfill.parse(envelope.payload);
  orderFulfillSchema.parse(payload);
  return { kind: "fulfill", payload };
}

export function loadOrderAttempt(storage: OrderAttemptStorage, key: string): OrderAttempt | null {
  const raw = storage.getItem(key);
  return raw === null ? null : parseOrderAttempt(JSON.parse(raw));
}

export function persistOrderAttempt(storage: OrderAttemptStorage, key: string, value: OrderAttempt): void {
  const raw = JSON.stringify(parseOrderAttempt(value));
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Attempt persistence failed");
}

export function clearOrderAttempt(storage: OrderAttemptStorage, key: string): void {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Attempt clearing failed");
}
