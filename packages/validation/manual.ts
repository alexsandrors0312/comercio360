import { z } from "zod";

const uuid = z.uuid();
const scope = z.object({ organizationId: uuid, storeId: uuid }).strict();
const key = uuid;
const cents = z.number().int().min(1).max(1_000_000_000_000);
const shortText = z.string().trim().max(240);
const reason = z.string().trim().min(3).max(240);
const status = z.enum(["draft", "scheduled", "completed", "cancelled"]);
const channel = z.enum(["store", "whatsapp", "instagram", "other"]);

export const manualCommandSchema = z.union([
  z.object({ module: z.literal("finance"), scope, key, operation: z.literal("record"),
    payload: z.object({ saleId: uuid, amountCents: cents, method: z.enum(["cash", "pix", "card", "transfer", "other"]), note: shortText }).strict() }).strict(),
  z.object({ module: z.literal("finance"), scope, key, operation: z.literal("reverse"),
    payload: z.object({ receiptId: uuid, reason }).strict() }).strict(),
  z.object({ module: z.literal("finance"), scope, key, operation: z.literal("cash"),
    payload: z.object({ direction: z.enum(["in", "out"]), amountCents: cents, note: reason }).strict() }).strict(),
  z.object({ module: z.literal("deliveries"), scope, key, operation: z.literal("create"),
    payload: z.object({ saleId: uuid, mode: z.enum(["pickup", "local_delivery"]),
      dueAt: z.iso.datetime().nullable(), assignedLabel: z.string().trim().max(120) }).strict() }).strict(),
  z.object({ module: z.literal("deliveries"), scope, key, operation: z.literal("transition"),
    payload: z.object({ id: uuid, revision: z.string().regex(/^[1-9]\d*$/),
      status: z.enum(["ready", "out_for_delivery", "completed", "cancelled"]) }).strict() }).strict(),
  z.object({ module: z.literal("marketing"), scope, key, operation: z.literal("create"),
    payload: z.object({ title: z.string().trim().min(3).max(120), channel,
      plannedAt: z.iso.datetime() }).strict() }).strict(),
  z.object({ module: z.literal("marketing"), scope, key, operation: z.literal("update"),
    payload: z.object({ id: uuid, revision: z.string().regex(/^[1-9]\d*$/),
      title: z.string().trim().min(3).max(120), channel, plannedAt: z.iso.datetime() }).strict() }).strict(),
  z.object({ module: z.literal("marketing"), scope, key, operation: z.literal("transition"),
    payload: z.object({ id: uuid, revision: z.string().regex(/^[1-9]\d*$/),
      status: z.enum(["scheduled", "completed", "cancelled"]) }).strict() }).strict(),
]);
export type ManualCommand = z.infer<typeof manualCommandSchema>;

const sale = z.object({ id: uuid, status: z.enum(["confirmed", "cancelled"]).optional(),
  totalCents: z.string().regex(/^\d+$/), receivedCents: z.string().regex(/^\d+$/).optional(),
  createdAt: z.string() });
export const financeDataSchema = z.object({
  cashBalanceCents: z.string(), sales: z.array(sale),
  receipts: z.array(z.object({ id: uuid, saleId: uuid, amountCents: z.string(),
    method: z.string(), note: z.string(), status: z.enum(["posted", "reversed"]),
    createdAt: z.string(), reversalReason: z.string().nullable() })),
  cashEntries: z.array(z.object({ id: uuid, direction: z.enum(["in", "out"]),
    amountCents: z.string(), note: z.string(), createdAt: z.string() })),
});
export const deliveryDataSchema = z.object({ sales: z.array(sale),
  deliveries: z.array(z.object({ id: uuid, saleId: uuid, mode: z.enum(["pickup", "local_delivery"]),
    status: z.enum(["queued", "ready", "out_for_delivery", "completed", "cancelled"]),
    dueAt: z.string().nullable(), assignedLabel: z.string(), revision: z.string(),
    createdAt: z.string(), updatedAt: z.string() })) });
export const marketingDataSchema = z.object({ campaigns: z.array(z.object({
  id: uuid, title: z.string(), channel, plannedAt: z.string(), status,
  revision: z.string(), createdAt: z.string(),
})) });
export type FinanceData = z.infer<typeof financeDataSchema>;
export type DeliveryData = z.infer<typeof deliveryDataSchema>;
export type MarketingData = z.infer<typeof marketingDataSchema>;

export function brlToCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result > 0 && result <= 1_000_000_000_000 ? result : null;
}
