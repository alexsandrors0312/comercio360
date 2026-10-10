"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeSales,
  SalesAccessError,
  salesRevision,
  listSaleVariants,
} from "../../lib/sales/server";
import { saleSchema, saleCancelSchema } from "../../packages/validation/sales";
import type {
  SalesScope,
  SaleInput,
  SaleCancelInput,
  SalesResult,
  SaleVariantSearchResult,
} from "../../packages/domain/sales-contracts";
type Failure = Exclude<SalesResult["status"], "success">;
const messages: Record<Failure, string> = {
  invalid: "Confira os SKUs, as quantidades, os preços e o motivo informado.",
  denied: "Você não tem permissão para esta operação do PDV nesta loja.",
  conflict:
    "O preço, a venda ou esta chave mudou. Atualize e revise os dados antes de tentar novamente.",
  insufficient:
    "Saldo insuficiente. Nenhum item desta venda foi baixado. Revise as quantidades.",
  unavailable:
    "Não foi possível confirmar o resultado. Confirme o envio anterior com os mesmos dados para evitar duplicidade.",
};
const failure = (status: Failure): SalesResult => ({
  status,
  message: messages[status],
});
const resultSchema = z
  .array(z.object({ id: z.uuid(), revision: salesRevision }))
  .length(1);
async function mutate<T>(
  scope: SalesScope,
  mode: "confirm" | "cancel",
  schema: z.ZodType<T>,
  input: unknown,
  rpc: string,
  parameters: (value: T) => Record<string, unknown>,
  message: string,
): Promise<SalesResult> {
  try {
    const access = await authorizeSales(scope, mode);
    const parsed = schema.safeParse(input);
    if (!parsed.success) return failure("invalid");
    const { data, error } = await access.supabase.rpc(rpc, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...parameters(parsed.data),
    });
    if (error) {
      if (error.code === "42501") return failure("denied");
      if (error.code === "PT409") return failure("conflict");
      if (error.code === "PT422") return failure("insufficient");
      if (["22023", "23514", "23503", "22P02", "22003"].includes(error.code))
        return failure("invalid");
      return failure("unavailable");
    }
    const rows = resultSchema.safeParse(data);
    if (!rows.success) return failure("unavailable");
    revalidatePath("/app/pdv");
    revalidatePath("/app/estoque");
    return { status: "success", message, ...rows.data[0] };
  } catch (error) {
    return failure(
      error instanceof SalesAccessError ? error.kind : "unavailable",
    );
  }
}
export async function confirmSale(
  scope: SalesScope,
  input: SaleInput,
): Promise<SalesResult> {
  return mutate(
    scope,
    "confirm",
    saleSchema,
    input,
    "sales_confirm",
    (v) => ({
      p_items: v.items.map((i) => ({
        variant_id: i.variantId,
        quantity: i.quantity,
        expected_unit_price_cents: i.expectedUnitPriceCents,
      })),
      p_idempotency_key: v.idempotencyKey,
    }),
    "Venda confirmada. Estoque atualizado.",
  );
}
export async function cancelSale(
  scope: SalesScope,
  input: SaleCancelInput,
): Promise<SalesResult> {
  return mutate(
    scope,
    "cancel",
    saleCancelSchema,
    input,
    "sales_cancel",
    (v) => ({
      p_sale_id: v.saleId,
      p_expected_revision: v.expectedRevision,
      p_reason: v.reason,
      p_idempotency_key: v.idempotencyKey,
    }),
    "Venda cancelada. Mercadorias repostas no estoque.",
  );
}
export async function findSaleVariants(
  scope: SalesScope,
  query: string,
): Promise<SaleVariantSearchResult> {
  try {
    await authorizeSales(scope);
    if (!z.string().max(200).safeParse(query).success)
      return {
        status: "invalid",
        message:
          "Busque produto, SKU ou código de barras com até 200 caracteres.",
      };
    const variants = await listSaleVariants(scope, { query, pageSize: 100 });
    return { status: "success", items: variants.items };
  } catch (error) {
    return {
      status: error instanceof SalesAccessError ? error.kind : "unavailable",
      message: "Não foi possível buscar os SKUs desta loja.",
    };
  }
}
