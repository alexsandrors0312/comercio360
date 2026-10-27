import "server-only";

import { z } from "zod";
import { createClient, isConfigured } from "@/lib/supabase/server";
import {
  marketingProductSearchDataSchema,
  marketingProductSearchInputSchema,
  marketingRichDataSchema,
  marketingSaveCommandSchema,
  type MarketingProductSearchData,
  type MarketingRichData,
  type MarketingScope,
} from "@/packages/validation/marketing";

const scopeSchema = z.object({
  organizationId: z.uuid(),
  storeId: z.uuid(),
}).strict();
const saveResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(["draft", "scheduled", "completed", "cancelled"]),
  revision: z.string().regex(/^[1-9]\d*$/),
});

export class MarketingAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "conflict" | "unknown") {
    super(kind === "invalid" ? "Confira os dados da campanha."
      : kind === "denied" ? "Você não tem acesso ao marketing desta loja."
        : kind === "conflict" ? "A campanha mudou. Atualize a página e confira os dados."
          : "Não foi possível confirmar o resultado. Tente novamente.");
  }
}

function classify(code: string | undefined) {
  return new MarketingAccessError(code === "42501" ? "denied"
    : ["PT409", "23505"].includes(code ?? "") ? "conflict"
      : ["22023", "22P02", "23514", "23502", "23503"].includes(code ?? "") ? "invalid"
        : "unknown");
}

export async function authorizedMarketingClient(scope: MarketingScope) {
  if (!scopeSchema.safeParse(scope).success) throw new MarketingAccessError("invalid");
  if (!isConfigured()) throw new MarketingAccessError("unknown");
  try {
    const client = await createClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) throw new MarketingAccessError("denied");
    return client;
  } catch (error) {
    throw error instanceof MarketingAccessError ? error : new MarketingAccessError("unknown");
  }
}

export async function readMarketingRich(
  scope: MarketingScope,
  from: string,
  until: string,
): Promise<MarketingRichData> {
  const start = new Date(from);
  const end = new Date(until);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) ||
    end <= start || end.valueOf() - start.valueOf() > 62 * 86_400_000)
    throw new MarketingAccessError("invalid");
  try {
    const client = await authorizedMarketingClient(scope);
    const { data, error } = await client.rpc("marketing_rich_read", {
      p_org: scope.organizationId,
      p_store: scope.storeId,
      p_from: start.toISOString(),
      p_until: end.toISOString(),
    }, { get: true });
    if (error) throw classify(error.code);
    return marketingRichDataSchema.parse(data);
  } catch (error) {
    throw error instanceof MarketingAccessError ? error : new MarketingAccessError("unknown");
  }
}

export async function readMarketingProducts(input: unknown): Promise<MarketingProductSearchData> {
  const parsed = marketingProductSearchInputSchema.safeParse(input);
  if (!parsed.success) throw new MarketingAccessError("invalid");
  const value = parsed.data;
  try {
    const client = await authorizedMarketingClient(value.scope);
    const { data, error } = await client.rpc("marketing_product_search", {
      p_org: value.scope.organizationId,
      p_store: value.scope.storeId,
      p_query: value.query,
      p_limit: value.limit,
      p_offset: value.offset,
    }, { get: true });
    if (error) throw classify(error.code);
    return marketingProductSearchDataSchema.parse(data);
  } catch (error) {
    throw error instanceof MarketingAccessError ? error : new MarketingAccessError("unknown");
  }
}

export type MarketingSaveResult =
  | { status: "success"; result: z.infer<typeof saveResultSchema> }
  | { status: "invalid" | "denied" | "conflict" | "unknown"; message: string };

export async function executeMarketingSave(input: unknown): Promise<MarketingSaveResult> {
  const parsed = marketingSaveCommandSchema.safeParse(input);
  if (!parsed.success) {
    const failure = new MarketingAccessError("invalid");
    return { status: failure.kind, message: failure.message };
  }
  const value = parsed.data;
  try {
    const client = await authorizedMarketingClient(value.scope);
    const { data, error } = await client.rpc("marketing_rich_save", {
      p_org: value.scope.organizationId,
      p_store: value.scope.storeId,
      p_campaign: value.campaignId,
      p_expected_revision: value.expectedRevision,
      p_objective: value.objective,
      p_content: value.contentBody,
      p_variants: value.variantIds,
      p_key: value.key,
    });
    if (error) throw classify(error.code);
    return { status: "success", result: saveResultSchema.parse(data) };
  } catch (error) {
    const failure = error instanceof MarketingAccessError ? error : new MarketingAccessError("unknown");
    return { status: failure.kind, message: failure.message };
  }
}
