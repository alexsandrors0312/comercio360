"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeProcurement,
  ProcurementAccessError,
  procurementRevision,
} from "../../lib/procurement/server";
import { listInventoryStock } from "../../lib/inventory/server";
import {
  procurementSupplierSchema,
  purchaseOrderSchema,
  purchaseTransitionSchema,
  purchaseCancelSchema,
} from "../../packages/validation/procurement";
import type {
  ProcurementScope,
  SupplierInput,
  PurchaseInput,
  PurchaseTransitionInput,
  PurchaseCancelInput,
  ProcurementResult,
  VariantSearchResult,
} from "../../packages/domain/procurement-contracts";

type Failure = Exclude<ProcurementResult["status"], "success">;
const messages: Record<Failure, string> = {
  invalid:
    "Confira o fornecedor, os itens, as quantidades e os custos informados.",
  denied: "Você não tem permissão para esta operação de compras nesta loja.",
  conflict:
    "O pedido ou fornecedor mudou, ou esta chave já foi usada com outros dados. Atualize e revise antes de tentar novamente.",
  duplicate: "Já existe um fornecedor com este nome na empresa.",
  unavailable:
    "Não foi possível confirmar a operação. Confirme o envio anterior com os mesmos dados.",
};
const failure = (status: Failure): ProcurementResult => ({
  status,
  message: messages[status],
});
const resultSchema = z
  .array(z.object({ id: z.uuid(), revision: procurementRevision }))
  .length(1);
async function mutate<T>(
  scope: ProcurementScope,
  mode: "manage" | "receive",
  schema: z.ZodType<T>,
  input: unknown,
  rpc: string,
  parameters: (value: T) => Record<string, unknown>,
  message: string,
): Promise<ProcurementResult> {
  try {
    const access = await authorizeProcurement(scope, mode);
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
      if (error.code === "23505") return failure("duplicate");
      if (["22023", "23514", "23503", "22P02", "22003"].includes(error.code))
        return failure("invalid");
      return failure("unavailable");
    }
    const rows = resultSchema.safeParse(data);
    if (!rows.success) return failure("unavailable");
    revalidatePath("/app/compras");
    if (mode === "receive") revalidatePath("/app/estoque");
    return { status: "success", message, ...rows.data[0] };
  } catch (error) {
    return failure(
      error instanceof ProcurementAccessError ? error.kind : "unavailable",
    );
  }
}
export async function saveProcurementSupplier(
  scope: ProcurementScope,
  input: SupplierInput,
): Promise<ProcurementResult> {
  return mutate(
    scope,
    "manage",
    procurementSupplierSchema,
    input,
    "procurement_save_supplier",
    (v) => ({
      p_supplier_id: v.supplierId,
      p_name: v.name,
      p_contact: v.contact,
      p_active: v.active,
      p_expected_revision: v.expectedRevision,
      p_idempotency_key: v.idempotencyKey,
    }),
    "Fornecedor salvo.",
  );
}
export async function createPurchaseOrder(
  scope: ProcurementScope,
  input: PurchaseInput,
): Promise<ProcurementResult> {
  return mutate(
    scope,
    "manage",
    purchaseOrderSchema,
    input,
    "procurement_create_order",
    (v) => ({
      p_supplier_id: v.supplierId,
      p_items: v.items.map((i) => ({
        variant_id: i.variantId,
        quantity: i.quantity,
        unit_cost_cents: i.unitCostCents,
      })),
      p_idempotency_key: v.idempotencyKey,
    }),
    "Pedido de compra criado.",
  );
}
export async function receivePurchaseOrder(
  scope: ProcurementScope,
  input: PurchaseTransitionInput,
): Promise<ProcurementResult> {
  return mutate(
    scope,
    "receive",
    purchaseTransitionSchema,
    input,
    "procurement_receive_order",
    (v) => ({
      p_order_id: v.orderId,
      p_expected_revision: v.expectedRevision,
      p_idempotency_key: v.idempotencyKey,
    }),
    "Pedido recebido. Estoque atualizado.",
  );
}
export async function cancelPurchaseOrder(
  scope: ProcurementScope,
  input: PurchaseCancelInput,
): Promise<ProcurementResult> {
  return mutate(
    scope,
    "manage",
    purchaseCancelSchema,
    input,
    "procurement_cancel_order",
    (v) => ({
      p_order_id: v.orderId,
      p_expected_revision: v.expectedRevision,
      p_reason: v.reason,
      p_idempotency_key: v.idempotencyKey,
    }),
    "Pedido de compra cancelado.",
  );
}
export async function findPurchaseVariants(
  scope: ProcurementScope,
  query: string,
): Promise<VariantSearchResult> {
  try {
    await authorizeProcurement(scope, "read");
    if (!z.string().max(200).safeParse(query).success)
      return {
        status: "invalid",
        message: "Busque pelo nome do produto ou SKU, com até 200 caracteres.",
      };
    const stock = await listInventoryStock(scope, { query, pageSize: 100 });
    return {
      status: "success",
      items: stock.items
        .filter((i) => i.active)
        .map(({ variantId, productName, sku }) => ({
          variantId,
          productName,
          sku,
        })),
    };
  } catch (error) {
    return {
      status:
        error instanceof ProcurementAccessError && error.kind === "denied"
          ? "denied"
          : "unavailable",
      message: "Não foi possível buscar os SKUs disponíveis nesta loja.",
    };
  }
}
