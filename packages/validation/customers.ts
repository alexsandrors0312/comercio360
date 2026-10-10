import { z } from "zod";
import { parseInventoryRevision } from "../domain/inventory";
import {
  customerCharacterCount,
  hasCustomerControl,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
} from "../domain/customers";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const revision = z
  .string()
  .refine(
    (value) => value !== "0" && parseInventoryRevision(value) !== null,
    "Revisão inválida",
  );

export const customerNameSchema = z
  .string()
  .transform(normalizeCustomerName)
  .refine(
    (value) =>
      customerCharacterCount(value) >= 2 &&
      customerCharacterCount(value) <= 120 &&
      !hasCustomerControl(value),
    "Nome deve ter de 2 a 120 caracteres, sem controles",
  );

export const customerPhoneSchema = z
  .string()
  .nullish()
  .transform(normalizeCustomerPhone)
  .refine(
    (value) => value === null || /^[0-9]{8,15}$/.test(value),
    "Telefone deve ter de 8 a 15 dígitos",
  );

export const customerEmailSchema = z
  .string()
  .nullish()
  .transform(normalizeCustomerEmail)
  .pipe(z.email().max(254).nullable());

export const customerSaveSchema = z
  .object({
    customerId: uuid.nullish().transform((value) => value ?? null),
    expectedRevision: revision.nullish().transform((value) => value ?? null),
    name: customerNameSchema,
    phone: customerPhoneSchema,
    email: customerEmailSchema,
    active: z.boolean(),
    idempotencyKey: uuid,
  })
  .refine(
    ({ customerId, expectedRevision }) =>
      (customerId === null) === (expectedRevision === null),
    "Cliente e revisão devem ser informados juntos na edição",
  )
  .refine(
    ({ customerId, active }) => customerId !== null || active,
    "Cliente novo deve estar ativo",
  );

const page = z.number().int().min(1).max(100000).default(1);
const pageSize = z.number().int().min(1).max(100).default(20);
const query = z
  .string()
  .transform((value) => value.trim())
  .refine(
    (value) =>
      customerCharacterCount(value) <= 200 && !hasCustomerControl(value),
    "Busca deve ter até 200 caracteres, sem controles",
  )
  .default("");

export const customerListSchema = z.object({
  query,
  status: z.enum(["all", "active", "inactive"]).default("all"),
  page,
  pageSize,
  customerId: uuid.nullish().transform((value) => value ?? null),
});

export const customerHistorySchema = z.object({
  customerId: uuid,
  page,
  pageSize,
});

export const customerSearchSchema = z.object({ query });
