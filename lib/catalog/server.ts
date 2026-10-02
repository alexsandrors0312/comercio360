import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import { parseBrlDecimal } from "../../packages/domain/catalog";

const scopeSchema = z.object({
  organizationId: z.uuid(),
  storeId: z.uuid(),
});
const filtersSchema = z.object({
  query: z.string().max(200).default(""),
  categoryId: z.uuid().nullable().default(null),
  status: z.enum(["all", "active", "inactive"]).default("active"),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type CatalogScope = z.input<typeof scopeSchema>;
export type CatalogFilters = z.input<typeof filtersSchema>;
export type CatalogCategory = {
  id: string;
  name: string;
  active: boolean;
  revision: string;
};
export type CatalogPrice = { value: string; revision: string };
export type CatalogVariant = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  unit: "UN";
  barcode: string | null;
  active: boolean;
  revision: string;
  price: CatalogPrice | null;
};
export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  active: boolean;
  revision: string;
  hasCover: boolean;
  variants: CatalogVariant[];
};
export type CatalogProductSummary = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  active: boolean;
  revision: string;
  priceFrom: string | null;
};
export type CatalogPage = {
  items: CatalogProductSummary[];
  page: number;
  pageSize: number;
  total: number;
};

export class CatalogAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção de catálogo inválida."
        : kind === "denied"
          ? "Você não tem acesso a este catálogo."
          : "Não foi possível carregar o catálogo. Tente novamente.",
    );
  }
}

type CatalogRole = "owner" | "manager" | "cashier" | "stockist" | "buyer";
const readableRoles: readonly string[] = [
  "owner",
  "manager",
  "cashier",
  "stockist",
  "buyer",
];
const writableRoles: readonly string[] = ["owner", "manager"];

export async function authorizeCatalog(
  scope: CatalogScope,
  mode: "read" | "write" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new CatalogAccessError("invalid");
  if (!isConfigured()) throw new CatalogAccessError("unavailable");

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new CatalogAccessError("denied");

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
  if (member.error || store.error) throw new CatalogAccessError("unavailable");
  const role = member.data?.role;
  if (
    !role ||
    !readableRoles.includes(role) ||
    !store.data ||
    (mode === "write" && !writableRoles.includes(role))
  ) {
    throw new CatalogAccessError("denied");
  }
  return {
    supabase,
    userId: auth.user.id,
    organizationId: parsed.data.organizationId,
    storeId: parsed.data.storeId,
    role: role as CatalogRole,
    canWrite: writableRoles.includes(role),
  };
}

export async function getCatalogAccess(scope: CatalogScope) {
  const access = await authorizeCatalog(scope);
  return {
    organizationId: access.organizationId,
    storeId: access.storeId,
    canWrite: access.canWrite,
  };
}

export async function listCatalogCategories(
  scope: CatalogScope,
): Promise<CatalogCategory[]> {
  const access = await authorizeCatalog(scope);
  const { data, error } = await access.supabase
    .from("product_categories")
    .select("id,name,active,revision")
    .eq("organization_id", access.organizationId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new CatalogAccessError("unavailable");
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    revision: String(row.revision),
  }));
}

type SearchRow = {
  product_id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  active: boolean;
  revision: number | string;
  price: number | string | null;
  total_count: number | string;
};

function priceText(value: number | string | null): string | null {
  if (value === null) return null;
  const normalized = parseBrlDecimal(String(value));
  if (normalized === null) throw new CatalogAccessError("unavailable");
  return normalized;
}

export async function listCatalogProducts(
  scope: CatalogScope,
  filters: CatalogFilters = {},
): Promise<CatalogPage> {
  const parsed = filtersSchema.safeParse(filters);
  if (!parsed.success) throw new CatalogAccessError("invalid");
  const access = await authorizeCatalog(scope);
  const { query, categoryId, status, page, pageSize } = parsed.data;
  const args = {
    p_organization_id: access.organizationId,
    p_store_id: access.storeId,
    p_query: query.trim(),
    p_category_id: categoryId,
    p_active: status === "all" ? null : status === "active",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  };
  const result = await access.supabase.rpc("catalog_search_products", args);
  if (result.error) {
    if (result.error.code === "42501") throw new CatalogAccessError("denied");
    throw new CatalogAccessError("unavailable");
  }
  const rows = (result.data ?? []) as SearchRow[];
  let total = rows.length ? Number(rows[0].total_count) : 0;
  // A window count is absent on a page beyond the end of a result set.
  if (!rows.length && page > 1) {
    const first = await access.supabase.rpc("catalog_search_products", {
      ...args,
      p_limit: 1,
      p_offset: 0,
    });
    if (first.error) {
      if (first.error.code === "42501") throw new CatalogAccessError("denied");
      throw new CatalogAccessError("unavailable");
    }
    const firstRows = (first.data ?? []) as SearchRow[];
    total = firstRows.length ? Number(firstRows[0].total_count) : 0;
  }
  return {
    items: rows.map((row) => ({
      id: row.product_id,
      name: row.name,
      description: row.description,
      categoryId: row.category_id,
      active: row.active,
      revision: String(row.revision),
      priceFrom: priceText(row.price),
    })),
    page,
    pageSize,
    total,
  };
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  active: boolean;
  revision: number | string;
};
type VariantRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  unit: "UN";
  barcode: string | null;
  active: boolean;
  revision: number | string;
};
type PriceRow = {
  variant_id: string;
  amount: number | string;
  revision: number | string;
};

export async function getCatalogProduct(
  scope: CatalogScope,
  productId: string,
): Promise<CatalogProduct | null> {
  if (!z.uuid().safeParse(productId).success)
    throw new CatalogAccessError("invalid");
  const access = await authorizeCatalog(scope);
  const productResult = await access.supabase
    .from("products")
    .select("id,name,description,category_id,active,revision")
    .eq("organization_id", access.organizationId)
    .eq("id", productId)
    .maybeSingle();
  if (productResult.error) throw new CatalogAccessError("unavailable");
  if (!productResult.data) return null;
  const product = productResult.data as ProductRow;
  const [variantResult, coverResult] = await Promise.all([
    access.supabase
      .from("product_variants")
      .select("id,sku,color,size,unit,barcode,active,revision")
      .eq("organization_id", access.organizationId)
      .eq("product_id", productId)
      .order("sku", { ascending: true })
      .order("id", { ascending: true }),
    access.supabase
      .from("product_images")
      .select("id")
      .eq("organization_id", access.organizationId)
      .eq("product_id", productId)
      .maybeSingle(),
  ]);
  if (variantResult.error || coverResult.error)
    throw new CatalogAccessError("unavailable");
  const variantRows = (variantResult.data ?? []) as VariantRow[];
  let prices: PriceRow[] = [];
  if (variantRows.length) {
    const priceResult = await access.supabase
      .from("product_prices")
      .select("variant_id,amount,revision")
      .eq("organization_id", access.organizationId)
      .eq("store_id", access.storeId)
      .in(
        "variant_id",
        variantRows.map((variant) => variant.id),
      );
    if (priceResult.error) throw new CatalogAccessError("unavailable");
    prices = (priceResult.data ?? []) as PriceRow[];
  }
  const byVariant = new Map(prices.map((price) => [price.variant_id, price]));
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    active: product.active,
    revision: String(product.revision),
    hasCover: Boolean(coverResult.data),
    variants: variantRows.map((variant) => {
      const price = byVariant.get(variant.id);
      return {
        id: variant.id,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        unit: variant.unit,
        barcode: variant.barcode,
        active: variant.active,
        revision: String(variant.revision),
        price: price
          ? {
              value: priceText(price.amount)!,
              revision: String(price.revision),
            }
          : null,
      };
    }),
  };
}
