import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import type {
  InventoryScope,
  InventoryItem,
  InventoryStockPage,
  InventoryHistoryPage,
} from "../../packages/domain/inventory-contracts";

const scopeSchema = z.object({ organizationId: z.uuid(), storeId: z.uuid() });
const pageSchema = z.object({
  query: z.string().max(200).default(""),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
const readRoles = ["owner", "manager", "stockist", "cashier", "buyer"];
const writeRoles = ["owner", "manager", "stockist"];
const unsigned = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const quantity = unsigned.pipe(z.number().max(2147483647));
const revision = z
  .union([
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^(0|[1-9]\d{0,18})$/),
  ])
  .transform(String)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const stockRow = z.object({
  variant_id: z.uuid(),
  product_name: z.string(),
  sku: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  active: z.boolean(),
  quantity,
  revision,
  total_count: unsigned,
});
const historyRow = z.object({
  id: z.uuid(),
  kind: z.enum(["entry", "exit"]),
  quantity: unsigned.pipe(z.number().min(1).max(1000000)),
  reason: z.string(),
  balance_after: quantity,
  created_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  total_count: unsigned,
});

export class InventoryAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção de estoque inválida."
        : kind === "denied"
          ? "Você não tem acesso ao estoque desta loja."
          : "Não foi possível carregar o estoque. Tente novamente.",
    );
  }
}

/** A live session and an explicit store grant are required on every server entry. */
export async function authorizeInventory(
  scope: InventoryScope,
  mode: "read" | "write" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new InventoryAccessError("invalid");
  if (!isConfigured()) throw new InventoryAccessError("unavailable");
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) throw new InventoryAccessError("denied");
  const [member, store] = await Promise.all([
    supabase
      .from("memberships")
      .select("role")
      .eq("organization_id", parsed.data.organizationId)
      .eq("user_id", auth.user.id)
      .eq("active", true)
      .maybeSingle(),
    // Store RLS requires the user's explicit grant; owner/manager are not bypasses.
    supabase
      .from("stores")
      .select("id")
      .eq("organization_id", parsed.data.organizationId)
      .eq("id", parsed.data.storeId)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (member.error || store.error)
    throw new InventoryAccessError("unavailable");
  const role = member.data?.role;
  if (
    !role ||
    !readRoles.includes(role) ||
    !store.data ||
    (mode === "write" && !writeRoles.includes(role))
  )
    throw new InventoryAccessError("denied");
  return {
    supabase,
    organizationId: parsed.data.organizationId,
    storeId: parsed.data.storeId,
    canWrite: writeRoles.includes(role),
  };
}

export async function getInventoryAccess(scope: InventoryScope) {
  const access = await authorizeInventory(scope);
  return { canWrite: access.canWrite };
}

async function readRows(
  scope: InventoryScope,
  rpc: string,
  parameters: Record<string, unknown>,
) {
  const access = await authorizeInventory(scope);
  const result = await access.supabase.rpc(rpc, {
    p_organization_id: access.organizationId,
    p_store_id: access.storeId,
    ...parameters,
  });
  if (result.error)
    throw new InventoryAccessError(
      result.error.code === "42501" ? "denied" : "unavailable",
    );
  return result.data;
}
function item(row: z.output<typeof stockRow>): InventoryItem {
  return {
    variantId: row.variant_id,
    productName: row.product_name,
    sku: row.sku,
    color: row.color,
    size: row.size,
    active: row.active,
    quantity: row.quantity,
    revision: row.revision,
  };
}

export async function listInventoryStock(
  scope: InventoryScope,
  filters: z.input<typeof pageSchema> = {},
): Promise<InventoryStockPage> {
  const parsed = pageSchema.safeParse(filters);
  if (!parsed.success) throw new InventoryAccessError("invalid");
  const { query, page, pageSize } = parsed.data;
  const parameters = {
    p_query: query.trim(),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_variant_id: null,
  };
  const result = z
    .array(stockRow)
    .safeParse(await readRows(scope, "inventory_stock", parameters));
  if (!result.success) throw new InventoryAccessError("unavailable");
  let total = result.data[0]?.total_count ?? 0;
  if (!result.data.length && page > 1) {
    const first = z
      .array(stockRow)
      .safeParse(
        await readRows(scope, "inventory_stock", {
          ...parameters,
          p_limit: 1,
          p_offset: 0,
        }),
      );
    if (!first.success) throw new InventoryAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: result.data.map(item), page, pageSize, total };
}

export async function getInventoryItem(
  scope: InventoryScope,
  variantId: string,
): Promise<InventoryItem | null> {
  if (!z.uuid().safeParse(variantId).success)
    throw new InventoryAccessError("invalid");
  const rows = z
    .array(stockRow)
    .max(1)
    .safeParse(
      await readRows(scope, "inventory_stock", {
        p_query: "",
        p_limit: 1,
        p_offset: 0,
        p_variant_id: variantId,
      }),
    );
  if (!rows.success || (rows.data[0] && rows.data[0].variant_id !== variantId))
    throw new InventoryAccessError("unavailable");
  return rows.data[0] ? item(rows.data[0]) : null;
}

export async function listInventoryHistory(
  scope: InventoryScope,
  variantId: string,
  page = 1,
): Promise<InventoryHistoryPage> {
  if (
    !z.uuid().safeParse(variantId).success ||
    !pageSchema.safeParse({ page }).success
  )
    throw new InventoryAccessError("invalid");
  const pageSize = 10;
  const parameters = {
    p_variant_id: variantId,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  };
  const rows = z
    .array(historyRow)
    .safeParse(await readRows(scope, "inventory_history", parameters));
  if (!rows.success) throw new InventoryAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z
      .array(historyRow)
      .safeParse(
        await readRows(scope, "inventory_history", {
          ...parameters,
          p_limit: 1,
          p_offset: 0,
        }),
      );
    if (!first.success) throw new InventoryAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return {
    items: rows.data.map((row) => ({
      id: row.id,
      kind: row.kind,
      quantity: row.quantity,
      reason: row.reason,
      balanceAfter: row.balance_after,
      createdAt: row.created_at,
    })),
    page,
    pageSize,
    total,
  };
}
