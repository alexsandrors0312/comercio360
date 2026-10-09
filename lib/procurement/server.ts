import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import type {
  ProcurementScope,
  SupplierPage,
  PurchasePage,
  PurchaseDetail,
  ProcurementPermissions,
  Supplier,
  PurchaseOrder,
  PurchaseItem,
} from "../../packages/domain/procurement-contracts";

const scopeSchema = z.object({ organizationId: z.uuid(), storeId: z.uuid() });
const pages = z.object({
  query: z.string().max(200).default(""),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
const readRoles = ["owner", "manager", "buyer", "stockist"];
const manageRoles = ["owner", "manager", "buyer"];
const receiveRoles = ["owner", "manager", "stockist"];
export const procurementRevision = z
  .union([
    z.string().regex(/^[1-9]\d{0,18}$/),
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ])
  .transform(String)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const integer = z
  .union([z.string().regex(/^\d+$/), z.number().int()])
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const supplierRow = z.object({
  id: z.uuid(),
  name: z.string(),
  contact: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  active: z.boolean(),
  revision: procurementRevision,
  total_count: integer,
});
const timestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const orderRow = z.object({
  id: z.uuid(),
  supplier_id: z.uuid(),
  supplier_name: z.string(),
  status: z.enum(["open", "received", "cancelled"]),
  revision: procurementRevision,
  total_cents: integer.pipe(z.number().positive().max(100000000000)),
  created_at: timestamp,
  received_at: timestamp.nullable(),
  cancellation_reason: z.string().nullable(),
  total_count: integer,
});
const lineRow = z.object({
  variant_id: z.uuid(),
  product_name: z.string(),
  sku: z.string(),
  quantity: integer.pipe(z.number().min(1).max(1000000)),
  unit_cost_cents: integer.pipe(z.number().min(1).max(100000000)),
});

export class ProcurementAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção de compras inválida."
        : kind === "denied"
          ? "Você não tem permissão para esta operação de compras nesta loja."
          : "Não foi possível carregar compras e fornecedores. Tente novamente.",
    );
  }
}
export async function authorizeProcurement(
  scope: ProcurementScope,
  mode: "read" | "manage" | "receive" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new ProcurementAccessError("invalid");
  if (!isConfigured()) throw new ProcurementAccessError("unavailable");
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) throw new ProcurementAccessError("denied");
  const [member, store] = await Promise.all([
    supabase
      .from("memberships")
      .select("role")
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
  if (member.error || store.error)
    throw new ProcurementAccessError("unavailable");
  const role = member.data?.role;
  const roles =
    mode === "manage"
      ? manageRoles
      : mode === "receive"
        ? receiveRoles
        : readRoles;
  if (!role || !roles.includes(role) || !store.data)
    throw new ProcurementAccessError("denied");
  return {
    supabase,
    organizationId: parsed.data.organizationId,
    storeId: parsed.data.storeId,
    canManage: manageRoles.includes(role),
    canReceive: receiveRoles.includes(role),
  };
}
export async function getProcurementPermissions(
  scope: ProcurementScope,
): Promise<ProcurementPermissions> {
  const access = await authorizeProcurement(scope);
  return { canManage: access.canManage, canReceive: access.canReceive };
}
async function readRows(
  scope: ProcurementScope,
  rpc: string,
  params: Record<string, unknown>,
) {
  const access = await authorizeProcurement(scope);
  try {
    const result = await access.supabase.rpc(rpc, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...params,
    });
    if (result.error)
      throw new ProcurementAccessError(
        result.error.code === "42501" ? "denied" : "unavailable",
      );
    return result.data;
  } catch (error) {
    throw error instanceof ProcurementAccessError
      ? error
      : new ProcurementAccessError("unavailable");
  }
}
const supplier = (r: z.output<typeof supplierRow>): Supplier => ({
  id: r.id,
  name: r.name,
  contact: r.contact,
  active: r.active,
  revision: r.revision,
});
const order = (r: z.output<typeof orderRow>): PurchaseOrder => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  status: r.status,
  revision: r.revision,
  totalCents: r.total_cents,
  createdAt: r.created_at,
  receivedAt: r.received_at,
  cancellationReason: r.cancellation_reason,
});
const line = (r: z.output<typeof lineRow>): PurchaseItem => ({
  variantId: r.variant_id,
  productName: r.product_name,
  sku: r.sku,
  quantity: r.quantity,
  unitCostCents: r.unit_cost_cents,
});
export async function listProcurementSuppliers(
  scope: ProcurementScope,
  filters: z.input<typeof pages> = {},
): Promise<SupplierPage> {
  const parsed = pages.safeParse(filters);
  if (!parsed.success) throw new ProcurementAccessError("invalid");
  const { query, page, pageSize } = parsed.data;
  const params = {
    p_query: query.trim(),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_supplier_id: null,
  };
  const rows = z
    .array(supplierRow)
    .safeParse(await readRows(scope, "procurement_suppliers", params));
  if (!rows.success) throw new ProcurementAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z.array(supplierRow).safeParse(
      await readRows(scope, "procurement_suppliers", {
        ...params,
        p_limit: 1,
        p_offset: 0,
      }),
    );
    if (!first.success) throw new ProcurementAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(supplier), page, pageSize, total };
}
export async function listPurchaseOrders(
  scope: ProcurementScope,
  filters: z.input<typeof pages> & {
    status?: "all" | "open" | "received" | "cancelled";
  } = {},
): Promise<PurchasePage> {
  const parsed = pages
    .extend({
      status: z.enum(["all", "open", "received", "cancelled"]).default("all"),
    })
    .safeParse(filters);
  if (!parsed.success) throw new ProcurementAccessError("invalid");
  const { query, page, pageSize, status } = parsed.data;
  const params = {
    p_query: query.trim(),
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_order_id: null,
  };
  const rows = z
    .array(orderRow)
    .safeParse(await readRows(scope, "procurement_orders", params));
  if (!rows.success) throw new ProcurementAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z.array(orderRow).safeParse(
      await readRows(scope, "procurement_orders", {
        ...params,
        p_limit: 1,
        p_offset: 0,
      }),
    );
    if (!first.success) throw new ProcurementAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(order), page, pageSize, total };
}
export async function getPurchaseOrder(
  scope: ProcurementScope,
  orderId: string,
): Promise<PurchaseDetail | null> {
  if (!z.uuid().safeParse(orderId).success)
    throw new ProcurementAccessError("invalid");
  const data = await readRows(scope, "procurement_orders", {
    p_query: "",
    p_status: "all",
    p_limit: 1,
    p_offset: 0,
    p_order_id: orderId,
  });
  const rows = z.array(orderRow).max(1).safeParse(data);
  if (!rows.success || (rows.data[0] && rows.data[0].id !== orderId))
    throw new ProcurementAccessError("unavailable");
  if (!rows.data[0]) return null;
  const items = z
    .array(lineRow)
    .min(1)
    .max(50)
    .safeParse(
      await readRows(scope, "procurement_order_items", { p_order_id: orderId }),
    );
  if (!items.success) throw new ProcurementAccessError("unavailable");
  return { order: order(rows.data[0]), items: items.data.map(line) };
}
