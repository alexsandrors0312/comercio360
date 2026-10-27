import { z } from "zod";

export const marketingObjectiveSchema = z.enum([
  "promotion",
  "new_arrival",
  "clearance",
  "institutional",
]);

const scopeSchema = z.object({
  organizationId: z.uuid(),
  storeId: z.uuid(),
}).strict();

export const marketingProductSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  name: z.string(),
  sku: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  priceCents: z.string().regex(/^\d+$/).nullable(),
  quantity: z.number().int().nonnegative(),
  hasCover: z.boolean(),
});

export const marketingRichCampaignSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  channel: z.enum(["store", "whatsapp", "instagram", "other"]),
  plannedAt: z.string(),
  status: z.enum(["draft", "scheduled", "completed", "cancelled"]),
  revision: z.string().regex(/^[1-9]\d*$/),
  createdAt: z.string(),
  objective: marketingObjectiveSchema,
  contentBody: z.string(),
  products: z.array(marketingProductSchema),
});

export const marketingRichDataSchema = z.object({
  campaigns: z.array(marketingRichCampaignSchema),
  hasMore: z.boolean(),
});

export const marketingProductSearchDataSchema = z.object({
  items: z.array(marketingProductSchema),
  total: z.number().int().nonnegative(),
});

export const marketingSaveCommandSchema = z.object({
  scope: scopeSchema,
  campaignId: z.uuid(),
  expectedRevision: z.string().regex(/^[1-9]\d*$/),
  objective: marketingObjectiveSchema,
  contentBody: z.string().trim().max(2000),
  variantIds: z.array(z.uuid()).max(6).refine(
    ids => new Set(ids).size === ids.length,
    "Escolha cada variante apenas uma vez.",
  ),
  key: z.uuid(),
}).strict();

export const marketingProductSearchInputSchema = z.object({
  scope: scopeSchema,
  query: z.string().trim().max(120),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0).max(10_000),
}).strict();

export type MarketingScope = z.infer<typeof scopeSchema>;
export type MarketingObjective = z.infer<typeof marketingObjectiveSchema>;
export type MarketingProduct = z.infer<typeof marketingProductSchema>;
export type MarketingRichCampaign = z.infer<typeof marketingRichCampaignSchema>;
export type MarketingRichData = z.infer<typeof marketingRichDataSchema>;
export type MarketingProductSearchData = z.infer<typeof marketingProductSearchDataSchema>;
export type MarketingSaveCommand = z.infer<typeof marketingSaveCommandSchema>;
export type MarketingProductSearchInput = z.infer<typeof marketingProductSearchInputSchema>;
