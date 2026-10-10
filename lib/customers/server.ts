import "server-only";
import { z } from "zod";
import { createClient, isConfigured } from "../supabase/server";
import { MAX_SALE_TOTAL_CENTS } from "../../packages/domain/sales";
import { customerListSchema } from "../../packages/validation/customers";
import type {
  Customer,
  CustomerPage,
  CustomerSale,
  CustomerSalePage,
  CustomerPermissions,
  CustomerScope,
} from "../../packages/domain/customers-contracts";

const scopeSchema = z.object({ organizationId: z.uuid(), storeId: z.uuid() });
const listSchema = customerListSchema;
const historySchema = z.object({
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const customerRevision = z
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
const customerRow = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  active: z.boolean(),
  revision: customerRevision,
  created_at: timestamp,
  updated_at: timestamp,
  total_count: integer,
});
const customerSaleRow = z.object({
  id: z.uuid(),
  status: z.enum(["confirmed", "cancelled"]),
  revision: customerRevision,
  total_cents: integer.pipe(z.number().max(MAX_SALE_TOTAL_CENTS)),
  created_at: timestamp,
  cancelled_at: timestamp.nullable(),
  customer_name_snapshot: z.string(),
  total_count: integer,
});
const customer = (row: z.output<typeof customerRow>): Customer => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  active: row.active,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const sale = (row: z.output<typeof customerSaleRow>): CustomerSale => ({
  id: row.id,
  status: row.status,
  totalCents: row.total_cents,
  createdAt: row.created_at,
  cancelledAt: row.cancelled_at,
});
const readRoles = ["owner", "manager", "cashier"];
const editRoles = ["owner", "manager"];

export class CustomerAccessError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(
      kind === "invalid"
        ? "Seleção de clientes inválida."
        : kind === "denied"
          ? "Você não tem permissão para acessar clientes nesta loja."
          : "Não foi possível carregar clientes. Tente novamente.",
    );
  }
}

export async function authorizeCustomers(
  scope: CustomerScope,
  mode: "read" | "create" | "edit" = "read",
) {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new CustomerAccessError("invalid");
  if (!isConfigured()) throw new CustomerAccessError("unavailable");
  try {
    const supabase = await createClient();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth.user) throw new CustomerAccessError("denied");
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
    if (member.error || store.error) throw new CustomerAccessError("unavailable");
    const role = member.data?.role;
    if (!member.data || !role || !store.data || !(mode === "edit" ? editRoles : readRoles).includes(role))
      throw new CustomerAccessError("denied");
    const grant = await supabase
      .from("user_store_access")
      .select("store_id")
      .eq("organization_id", parsed.data.organizationId)
      .eq("membership_id", member.data.id)
      .eq("store_id", parsed.data.storeId)
      .limit(1);
    if (grant.error) throw new CustomerAccessError("unavailable");
    if (!grant.data?.length) throw new CustomerAccessError("denied");
    return {
      supabase,
      ...parsed.data,
      userId: auth.user.id,
      canCreate: readRoles.includes(role),
      canEdit: editRoles.includes(role),
    };
  } catch (error) {
    throw error instanceof CustomerAccessError
      ? error
      : new CustomerAccessError("unavailable");
  }
}

export async function getCustomerPermissions(
  scope: CustomerScope,
): Promise<CustomerPermissions> {
  const { canCreate, canEdit, userId } = await authorizeCustomers(scope);
  return { canCreate, canEdit, userId };
}

async function readRows(
  scope: CustomerScope,
  rpc: string,
  parameters: Record<string, unknown>,
) {
  const access = await authorizeCustomers(scope);
  try {
    const result = await access.supabase.rpc(rpc, {
      p_organization_id: access.organizationId,
      p_store_id: access.storeId,
      ...parameters,
    });
    if (result.error)
      throw new CustomerAccessError(
        result.error.code === "42501" ? "denied" : "unavailable",
      );
    return result.data;
  } catch (error) {
    throw error instanceof CustomerAccessError
      ? error
      : new CustomerAccessError("unavailable");
  }
}

export async function listCustomers(
  scope: CustomerScope,
  filters: z.input<typeof listSchema> = {},
): Promise<CustomerPage> {
  const parsed = listSchema.safeParse(filters);
  if (!parsed.success) throw new CustomerAccessError("invalid");
  const { query, status, page, pageSize, customerId } = parsed.data;
  const parameters = {
    p_query: query.trim(),
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_customer_id: customerId ?? null,
  };
  const rows = z.array(customerRow).safeParse(await readRows(scope, "customers_list", parameters));
  if (!rows.success) throw new CustomerAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z.array(customerRow).safeParse(
      await readRows(scope, "customers_list", {
        ...parameters,
        p_limit: 1,
        p_offset: 0,
      }),
    );
    if (!first.success) throw new CustomerAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(customer), page, pageSize, total };
}

export async function getCustomer(
  scope: CustomerScope,
  customerId: string,
): Promise<Customer | null> {
  if (!z.uuid().safeParse(customerId).success)
    throw new CustomerAccessError("invalid");
  const id = customerId.toLowerCase();
  const rows = await listCustomers(scope, { customerId: id, pageSize: 1 });
  if (rows.items[0] && rows.items[0].id !== id)
    throw new CustomerAccessError("unavailable");
  return rows.items[0] ?? null;
}

export async function listCustomerSales(
  scope: CustomerScope,
  customerId: string,
  filters: z.input<typeof historySchema> = {},
): Promise<CustomerSalePage> {
  if (!z.uuid().safeParse(customerId).success)
    throw new CustomerAccessError("invalid");
  const parsed = historySchema.safeParse(filters);
  if (!parsed.success) throw new CustomerAccessError("invalid");
  const { page, pageSize } = parsed.data;
  const parameters = {
    p_customer_id: customerId.toLowerCase(),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  };
  const rows = z.array(customerSaleRow).safeParse(
    await readRows(scope, "customers_sales", parameters),
  );
  if (!rows.success) throw new CustomerAccessError("unavailable");
  let total = rows.data[0]?.total_count ?? 0;
  if (!rows.data.length && page > 1) {
    const first = z.array(customerSaleRow).safeParse(
      await readRows(scope, "customers_sales", {
        ...parameters,
        p_limit: 1,
        p_offset: 0,
      }),
    );
    if (!first.success) throw new CustomerAccessError("unavailable");
    total = first.data[0]?.total_count ?? 0;
  }
  return { items: rows.data.map(sale), page, pageSize, total };
}
