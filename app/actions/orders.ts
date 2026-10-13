"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  authorizeOrders,
  listOrders,
  OrderAccessError,
  orderRevision,
} from "../../lib/orders/server";
import {
  orderCancelSchema,
  orderCreateSchema,
  orderFulfillSchema,
  orderListSchema,
} from "../../packages/validation/orders";
import type {
  CancelOrderInput,
  CreateOrderInput,
  FulfillOrderInput,
  OrderPage,
  OrderResult,
  OrderScope,
} from "../../packages/domain/orders-contracts";

export type OrderDirectoryResult =
  | { status: "success"; page: OrderPage }
  | { status: "invalid" | "denied" | "unavailable"; message: string };

type Failure = Exclude<OrderResult["status"], "success">;
const messages: Record<Failure, string> = {
  invalid: "Confira os itens, o cliente, o canal e o motivo informados.",
  denied: "Você não tem permissão para esta operação de pedidos nesta loja.",
  conflict:
    "O pedido, o preço ou esta chave mudou. Atualize e revise antes de tentar novamente.",
  insufficient:
    "Saldo insuficiente. O pedido continua aberto e nenhuma venda foi criada.",
  unavailable:
    "Não foi possível confirmar o resultado. Reenvie a mesma tentativa para evitar duplicidade.",
};
const failure = (status: Failure): OrderResult => ({
  status,
  message: messages[status],
});
const resultSchema = z
  .array(
    z.object({
      id: z.uuid(),
      revision: orderRevision,
      sale_id: z.uuid().nullable(),
    }),
  )
  .length(1);

async function mutate<T>(
  scope: OrderScope,
  mode: "create" | "cancel" | "fulfill",
  schema: z.ZodType<T>,
  input: unknown,
  rpc: string,
  parameters: (value: T) => Record<string, unknown>,
  successMessage: string,
): Promise<OrderResult> {
  try {
    const access = await authorizeOrders(scope, mode);
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
    if (!rows.success || (mode === "fulfill" && !rows.data[0].sale_id))
      return failure("unavailable");
    if (mode !== "fulfill" && rows.data[0].sale_id !== null)
      return failure("unavailable");
    revalidatePath("/app/pedidos");
    if (mode === "fulfill") {
      revalidatePath("/app/pdv");
      revalidatePath("/app/estoque");
      revalidatePath("/app/clientes");
    }
    return {
      status: "success",
      message: successMessage,
      id: rows.data[0].id,
      revision: rows.data[0].revision,
      saleId: rows.data[0].sale_id,
    };
  } catch (error) {
    return failure(
      error instanceof OrderAccessError ? error.kind : "unavailable",
    );
  }
}

export async function createOrder(
  scope: OrderScope,
  input: CreateOrderInput,
): Promise<OrderResult> {
  return mutate(
    scope,
    "create",
    orderCreateSchema,
    input,
    "orders_create",
    (value) => ({
      p_channel: value.channel,
      p_customer_id: value.customerId,
      p_items: value.items.map((item) => ({
        variant_id: item.variantId,
        quantity: item.quantity,
        expected_unit_price_cents: item.expectedUnitPriceCents,
      })),
      p_idempotency_key: value.idempotencyKey,
    }),
    "Pedido registrado. O estoque ainda não foi baixado.",
  );
}

export async function cancelOrder(
  scope: OrderScope,
  input: CancelOrderInput,
): Promise<OrderResult> {
  return mutate(
    scope,
    "cancel",
    orderCancelSchema,
    input,
    "orders_cancel",
    (value) => ({
      p_order_id: value.orderId,
      p_expected_revision: value.expectedRevision,
      p_reason: value.reason,
      p_idempotency_key: value.idempotencyKey,
    }),
    "Pedido cancelado sem movimentar estoque.",
  );
}

export async function fulfillOrder(
  scope: OrderScope,
  input: FulfillOrderInput,
): Promise<OrderResult> {
  return mutate(
    scope,
    "fulfill",
    orderFulfillSchema,
    input,
    "orders_fulfill",
    (value) => ({
      p_order_id: value.orderId,
      p_expected_revision: value.expectedRevision,
      p_idempotency_key: value.idempotencyKey,
    }),
    "Venda confirmada pelo pedido. Estoque atualizado.",
  );
}

export async function searchOrders(
  scope: OrderScope,
  filters: { status: "all" | "open" | "fulfilled" | "cancelled"; page: number; pageSize?: number },
): Promise<OrderDirectoryResult> {
  try {
    await authorizeOrders(scope);
    const parsed = orderListSchema.safeParse(filters);
    if (!parsed.success)
      return { status: "invalid", message: "Confira o filtro e a página informados." };
    return { status: "success", page: await listOrders(scope, parsed.data) };
  } catch (error) {
    return {
      status: error instanceof OrderAccessError ? error.kind : "unavailable",
      message: "Não foi possível buscar os pedidos desta loja.",
    };
  }
}
