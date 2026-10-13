import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import { orderListSchema } from "../../packages/validation/orders";
import type {
  Order,
  OrderDetail,
  OrderItem,
  OrderPage,
  OrderPermissions,
  OrderScope,
} from "../../packages/domain/orders-contracts";

const scopeSchema = z.object({ organizationId: z.uuid(), storeId: z.uuid() });
const readRoles = ["owner", "manager", "cashier"];
const cancelRoles = ["owner", "manager"];
export const orderRevision = z
  .union([
    z.string().regex(/^[1-9]\d{0,18}$/),
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const integer = z
  .union([z.string().regex(/^\d+$/), z.number().int()])
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const orderRow = z
  .object({
    id: z.uuid(),
    channel: z.enum(["counter", "whatsapp"]),
    status: z.enum(["open", "fulfilled", "cancelled"]),
    revision: orderRevision,
    customer_id: z.uuid().nullable(),
    customer_name_snapshot: z.string().nullable(),
    item_count: integer.pipe(z.number().min(1).max(50)),
    total_cents: integer.pipe(z.number().max(1000000000000)),
    created_at: timestamp,
    fulfilled_at: timestamp.nullable(),
    cancelled_at: timestamp.nullable(),
    cancellation_reason: z.string().nullable(),
    sale_id: z.uuid().nullable(),
    total_count: integer,
  })
  .refine(
    (row) =>
      (row.customer_id === null) === (row.customer_name_snapshot === null) &&
      (row.status === "open"
        ? row.sale_id === null && row.fulfilled_at === null && row.cancelled_at === null && row.cancellation_reason === null
        : row.status === "fulfilled"
          ? row.sale_id !== null && row.fulfilled_at !== null && row.cancelled_at === null && row.cancellation_reason === null
          : row.sale_id === null && row.fulfilled_at === null && row.cancelled_at !== null && row.cancellation_reason !== null),
  );
const itemRow = z.object({
  variant_id: z.uuid(),
  product_name: z.string(),
  sku: z.string(),
  quantity: integer.pipe(z.number().min(1).max(1000000)),
  unit_price_cents: integer.pipe(z.number().max(999999999999)),
});

const toOrder = (row: z.output<typeof orderRow>): Order => ({
  id: row.id,
  channel: row.channel,
  status: row.status,
  revision: row.revision,
  customerId: row.customer_id,
  customerNameSnapshot: row.customer_name_snapshot,
  itemCount: row.item_count,
  totalCents: row.total_cents,
  createdAt: row.created_at,
  fulfilledAt: row.fulfilled_at,
  cancelledAt: row.cancelled_at,
  cancellationReason: row.cancellation_reason,
  saleId: row.sale_id,
});
const toItem = (row: z.output<typeof itemRow>): OrderItem => ({
  variantId: row.variant_id,
  productName: row.product_name,
  sku: row.sku,
  quantity: row.quantity,
  unitPriceCents: row.unit_price_cents,
});

export class OrderAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção de pedidos inválida."
        : kind === "denied"
          ? "Você não tem permissão para acessar pedidos nesta loja."
          : "Não foi possível carregar os pedidos. Tente novamente.",
    );
  }
}

export async function authorizeOrders(
  scope: OrderScope,
  mode: "read" | "create" | "cancel" | "fulfill" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new OrderAccessError("invalid");
  if (!isConfigured()) throw new OrderAccessError("unavailable");
  try {
    const supabase = await createClient();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth.user) throw new OrderAccessError("denied");
    const [member, store] = await Promise.all([
      supabase
        .from("memberships")
        .select("id,role")
        .eq("organization_id", parsed.data.organizationId)
        .eq("user_id", auth.user.id)
        .eq("active", true)
        .maybeSingle(),
      supabase
        .from("stores")
        .select("id")
        .eq("organization_id", parsed.data.organizationId)
        .eq("id", parsed.data.storeId)
        .eq("active", true)
        .maybeSingle(),
    ]);
    if (member.error || store.error) throw new OrderAccessError("unavailable");
    const role = member.data?.role;
    if (
      !member.data ||
      !store.data ||
      !role ||
      !(mode === "cancel" ? cancelRoles : readRoles).includes(role)
    )
      throw new OrderAccessError("denied");
    const grant = await supabase
      .from("user_store_access")
      .select("store_id")
      .eq("organization_id", parsed.data.organizationId)
      .eq("membership_id", member.data.id)
      .eq("store_id", parsed.data.storeId)
      .limit(1);
    if (grant.error) throw new OrderAccessError("unavailable");
    if (!grant.data?.length) throw new OrderAccessError("denied");
    return {
      supabase,
      ...parsed.data,
      userId: auth.user.id,
      canCreate: readRoles.includes(role),
      canCancel: cancelRoles.includes(role),
      canFulfill: readRoles.includes(role),
    };
  } catch (error) {
    throw error instanceof OrderAccessError
      ? error
      : new OrderAccessError("unavailable");
  }
}

export async function getOrderPermissions(
  scope: OrderScope,
): Promise<OrderPermissions> {
  const { canCreate, canCancel, canFulfill, userId } = await authorizeOrders(scope);
  return { canCreate, canCancel, canFulfill, userId };
}

async function readRows(
  scope: OrderScope,
  rpc: string,
  parameters: Record<string, unknown>,
) {
  const access = await authorizeOrders(scope);
  try {
    const { data, error } = await access.supabase.rpc(rpc, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...parameters,
    });
    if (error)
      throw new OrderAccessError(
        error.code === "42501" ? "denied" : "unavailable",
      );
    return data;
  } catch (error) {
    throw error instanceof OrderAccessError
      ? error
      : new OrderAccessError("unavailable");
  }
}

export async function listOrders(
  scope: OrderScope,
  filters: z.input<typeof orderListSchema> = {},
): Promise<OrderPage> {
  const parsed = orderListSchema.safeParse(filters);
  if (!parsed.success) throw new OrderAccessError("invalid");
  const { status, page, pageSize, orderId } = parsed.data;
  const parameters = {
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_order_id: orderId ?? null,
  };
  const rows = z.array(orderRow).safeParse(await readRows(scope, "orders_list", parameters));
  if (!rows.success) throw new OrderAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1 && !orderId) {
    const first = z.array(orderRow).safeParse(
      await readRows(scope, "orders_list", {
        ...parameters,
        p_limit: 1,
        p_offset: 0,
      }),
    );
    if (!first.success) throw new OrderAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(toOrder), page, pageSize, total };
}

export async function getOrderDetail(
  scope: OrderScope,
  orderId: string,
): Promise<OrderDetail | null> {
  if (!z.uuid().safeParse(orderId).success) throw new OrderAccessError("invalid");
  const id = orderId.toLowerCase();
  const page = await listOrders(scope, { orderId: id, pageSize: 1 });
  const order = page.items[0];
  if (!order) return null;
  if (order.id !== id) throw new OrderAccessError("unavailable");
  const rows = z.array(itemRow).safeParse(
    await readRows(scope, "orders_items", { p_order_id: id }),
  );
  if (!rows.success || rows.data.length !== order.itemCount)
    throw new OrderAccessError("unavailable");
  return { order, items: rows.data.map(toItem) };
}
