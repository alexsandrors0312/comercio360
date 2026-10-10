import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  getSalesPermissions,
  listSales,
  getSale,
  SalesAccessError,
} from "@/lib/sales/server";
import { SalesWorkspace } from "@/packages/ui/sales/workspace";
type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";
export default async function SalesPage({
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
  const query = first(params.q).slice(0, 200);
  const statusValue = z
    .enum(["all", "confirmed", "cancelled"])
    .safeParse(first(params.estado));
  const status = statusValue.success ? statusValue.data : "all";
  const saleId = z.uuid().safeParse(first(params.venda)).success
    ? first(params.venda)
    : "";
  const page = /^\d{1,5}$/.test(first(params.pagina))
    ? Math.max(1, Number(first(params.pagina)))
    : 1;
  let data;
  let loadError: SalesAccessError | null = null;
  try {
    const [permissions, sales, selectedSale] = await Promise.all([
      getSalesPermissions(scope),
      listSales(scope, { query, status, page }),
      saleId ? getSale(scope, saleId) : Promise.resolve(null),
    ]);
    data = { permissions, sales, selectedSale };
  } catch (error) {
    if (!(error instanceof SalesAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data)
    return (
      <section role="alert" className="construction">
        <h1>PDV / Vendas</h1>
        <h2>
          {loadError?.kind === "denied"
            ? "Acesso não permitido"
            : "PDV indisponível"}
        </h2>
        <p>{loadError?.message}</p>
        {loadError?.kind !== "denied" && (
          <Link href="/app/pdv">Tentar novamente</Link>
        )}
      </section>
    );
  return (
    <SalesWorkspace
      key={data.permissions.userId + scope.organizationId + scope.storeId}
      scope={scope}
      storeName={access.active.name}
      permissions={data.permissions}
      sales={data.sales}
      selectedSale={data.selectedSale}
      query={query}
      status={status}
    />
  );
}
