import { z } from "zod";
import type {
  CustomerScope,
  SaveCustomerInput,
} from "../../domain/customers-contracts";

const uuid = z.uuid();
const inputSchema = z
  .object({
    customerId: uuid.nullable(),
    expectedRevision: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,17})$/)
      .nullable(),
    name: z.string().min(1).max(240),
    phone: z.string().max(64).nullable(),
    email: z.string().max(254).nullable(),
    active: z.boolean(),
    idempotencyKey: uuid,
  })
  .strict();
const attemptSchema = z
  .object({ kind: z.literal("save"), payload: inputSchema })
  .strict();

export type CustomerAttempt = { kind: "save"; payload: SaveCustomerInput };
export type CustomerAttemptStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function customerAttemptKey(
  scope: CustomerScope,
  userId: string,
): string {
  return `c360:clientes:v1:${userId}:${scope.organizationId}:${scope.storeId}`;
}

export function parseCustomerAttempt(value: unknown): CustomerAttempt {
  return attemptSchema.parse(value);
}

export function loadCustomerAttempt(
  storage: CustomerAttemptStorage,
  key: string,
): CustomerAttempt | null {
  const raw = storage.getItem(key);
  return raw === null ? null : parseCustomerAttempt(JSON.parse(raw));
}

export function persistCustomerAttempt(
  storage: CustomerAttemptStorage,
  key: string,
  attempt: CustomerAttempt,
): void {
  const raw = JSON.stringify(parseCustomerAttempt(attempt));
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error("Attempt persistence failed");
}

export function clearCustomerAttempt(
  storage: CustomerAttemptStorage,
  key: string,
): void {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Attempt clearing failed");
}
