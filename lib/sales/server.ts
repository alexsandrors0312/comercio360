import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import {
  MAX_SALE_TOTAL_CENTS,
  MAX_SALE_UNIT_PRICE_CENTS,
} from "../../packages/domain/sales";
import type {
  SalesScope,
  SalesPermissions,
  SaleVariant,
  SaleVariantPage,
  Sale,
  SalePage,
  SaleItem,
  SaleDetail,
} from "../../packages/domain/sales-contracts";

const scopeSchema = z.object({ organizationId: z.uuid(), storeId: z.uuid() });
const pages = z.object({
  query: z.string().max(200).default(""),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
const readRoles = ["owner", "manager", "cashier"];
const cancelRoles = ["owner", "manager"];
export const salesRevision = z
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
const timestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const variantRow = z.object({
  variant_id: z.uuid(),
  product_name: z.string(),
  sku: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  unit_price_cents: integer
    .pipe(z.number().max(MAX_SALE_UNIT_PRICE_CENTS))
    .nullable(),
  quantity: integer.pipe(z.number().max(2147483647)),
  total_count: integer,
});
const saleRow = z.object({
  id: z.uuid(),
  status: z.enum(["confirmed", "cancelled"]),
  revision: salesRevision,
  total_cents: integer.pipe(z.number().max(MAX_SALE_TOTAL_CENTS)),
  created_at: timestamp,
  cancelled_at: timestamp.nullable(),
  cancellation_reason: z.string().nullable(),
  total_count: integer,
});
const itemRow = z.object({
  variant_id: z.uuid(),
  product_name: z.string(),
  sku: z.string(),
  quantity: integer.pipe(z.number().min(1).max(1000000)),
  unit_price_cents: integer.pipe(z.number().max(MAX_SALE_UNIT_PRICE_CENTS)),
});
export class SalesAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção do PDV inválida."
        : kind === "denied"
          ? "Você não tem permissão para esta operação do PDV nesta loja."
          : "Não foi possível carregar o PDV. Tente novamente.",
    );
  }
}
export async function authorizeSales(
  scope: SalesScope,
  mode: "read" | "confirm" | "cancel" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new SalesAccessError("invalid");
  if (!isConfigured()) throw new SalesAccessError("unavailable");
  try {
    const supabase = await createClient();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth.user) throw new SalesAccessError("denied");
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
    if (member.error || store.error) throw new SalesAccessError("unavailable");
    const role = member.data?.role;
    if (
      !role ||
      !(mode === "cancel" ? cancelRoles : readRoles).includes(role) ||
      !store.data
    )
      throw new SalesAccessError("denied");
    return {
      supabase,
      ...parsed.data,
      userId: auth.user.id,
      canConfirm: readRoles.includes(role),
      canCancel: cancelRoles.includes(role),
    };
  } catch (error) {
    throw error instanceof SalesAccessError
      ? error
      : new SalesAccessError("unavailable");
  }
}
export async function getSalesPermissions(
  scope: SalesScope,
): Promise<SalesPermissions> {
  const { canConfirm, canCancel, userId } = await authorizeSales(scope);
  return { canConfirm, canCancel, userId };
}
async function readRows(
  scope: SalesScope,
  rpc: string,
  params: Record<string, unknown>,
) {
  const access = await authorizeSales(scope);
  try {
    const result = await access.supabase.rpc(rpc, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...params,
    });
    if (result.error)
      throw new SalesAccessError(
        result.error.code === "42501" ? "denied" : "unavailable",
      );
    return result.data;
  } catch (error) {
    throw error instanceof SalesAccessError
      ? error
      : new SalesAccessError("unavailable");
  }
}
const variant = (r: z.output<typeof variantRow>): SaleVariant => ({
  variantId: r.variant_id,
  productName: r.product_name,
  sku: r.sku,
  color: r.color,
  size: r.size,
  unitPriceCents: r.unit_price_cents,
  quantity: r.quantity,
});
const sale = (r: z.output<typeof saleRow>): Sale => ({
  id: r.id,
  status: r.status,
  revision: r.revision,
  totalCents: r.total_cents,
  createdAt: r.created_at,
  cancelledAt: r.cancelled_at,
  cancellationReason: r.cancellation_reason,
});
const item = (r: z.output<typeof itemRow>): SaleItem => ({
  variantId: r.variant_id,
  productName: r.product_name,
  sku: r.sku,
  quantity: r.quantity,
  unitPriceCents: r.unit_price_cents,
});
export async function listSaleVariants(
  scope: SalesScope,
  filters: z.input<typeof pages> = {},
): Promise<SaleVariantPage> {
  const parsed = pages.safeParse(filters);
  if (!parsed.success) throw new SalesAccessError("invalid");
  const { query, page, pageSize } = parsed.data;
  const params = {
    p_query: query.trim(),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  };
  const rows = z
    .array(variantRow)
    .safeParse(await readRows(scope, "sales_variants", params));
  if (!rows.success) throw new SalesAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z
      .array(variantRow)
      .safeParse(
        await readRows(scope, "sales_variants", {
          ...params,
          p_limit: 1,
          p_offset: 0,
        }),
      );
    if (!first.success) throw new SalesAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(variant), page, pageSize, total };
}
export async function listSales(
  scope: SalesScope,
  filters: z.input<typeof pages> & {
    status?: "all" | "confirmed" | "cancelled";
  } = {},
): Promise<SalePage> {
  const parsed = pages
    .extend({
      status: z.enum(["all", "confirmed", "cancelled"]).default("all"),
    })
    .safeParse(filters);
  if (!parsed.success) throw new SalesAccessError("invalid");
  const { query, page, pageSize, status } = parsed.data;
  const params = {
    p_query: query.trim(),
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_sale_id: null,
  };
  const rows = z
    .array(saleRow)
    .safeParse(await readRows(scope, "sales_list", params));
  if (!rows.success) throw new SalesAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z
      .array(saleRow)
      .safeParse(
        await readRows(scope, "sales_list", {
          ...params,
          p_limit: 1,
          p_offset: 0,
        }),
      );
    if (!first.success) throw new SalesAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(sale), page, pageSize, total };
}
export async function getSale(
  scope: SalesScope,
  saleId: string,
): Promise<SaleDetail | null> {
  if (!z.uuid().safeParse(saleId).success)
    throw new SalesAccessError("invalid");
  saleId = saleId.toLowerCase();
  const rows = z
    .array(saleRow)
    .max(1)
    .safeParse(
      await readRows(scope, "sales_list", {
        p_query: "",
        p_status: "all",
        p_limit: 1,
        p_offset: 0,
        p_sale_id: saleId,
      }),
    );
  if (!rows.success || (rows.data[0] && rows.data[0].id !== saleId))
    throw new SalesAccessError("unavailable");
  if (!rows.data[0]) return null;
  const items = z
    .array(itemRow)
    .min(1)
    .max(50)
    .safeParse(await readRows(scope, "sales_items", { p_sale_id: saleId }));
  if (
    !items.success ||
    new Set(items.data.map((v) => v.variant_id)).size !== items.data.length
  )
    throw new SalesAccessError("unavailable");
  return { sale: sale(rows.data[0]), items: items.data.map(item) };
}
