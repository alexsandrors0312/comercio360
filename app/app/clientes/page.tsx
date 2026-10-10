import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  CustomerAccessError,
  getCustomerPermissions,
  listCustomers,
  getCustomer,
  listCustomerSales,
} from "@/lib/customers/server";
import { CustomersWorkspace } from "@/packages/ui/customers/workspace";

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const access = await requireAccess();
  const scope = {
    organizationId: access.active.organization_id,
    storeId: access.active.id,
  };
  const params = await searchParams;
  const customerId = z.uuid().safeParse(first(params.cliente)).success
    ? first(params.cliente)
    : "";
  const salesPage = /^\d{1,5}$/.test(first(params.vendasPagina))
    ? Math.max(1, Number(first(params.vendasPagina)))
    : 1;
  let data;
  let loadError: CustomerAccessError | null = null;
  try {
    const [permissions, customers, selectedCustomer, customerSales] =
      await Promise.all([
        getCustomerPermissions(scope),
        listCustomers(scope),
        customerId ? getCustomer(scope, customerId) : Promise.resolve(null),
        customerId
          ? listCustomerSales(scope, customerId, { page: salesPage })
          : Promise.resolve(null),
      ]);
    data = { permissions, customers, selectedCustomer, customerSales };
  } catch (error) {
    if (!(error instanceof CustomerAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data)
    return (
      <section role="alert" className="construction">
        <h1>Clientes</h1>
        <h2>
          {loadError?.kind === "denied"
            ? "Acesso não permitido"
            : "Clientes indisponíveis"}
        </h2>
        <p>{loadError?.message}</p>
        {loadError?.kind !== "denied" && (
          <Link href="/app/clientes">Tentar novamente</Link>
        )}
      </section>
    );
  return (
    <CustomersWorkspace
      key={data.permissions.userId + scope.organizationId + scope.storeId}
      scope={scope}
      storeName={access.active.name}
      permissions={data.permissions}
      customers={data.customers}
      selectedCustomer={data.selectedCustomer}
      customerSales={data.customerSales}
    />
  );
}
