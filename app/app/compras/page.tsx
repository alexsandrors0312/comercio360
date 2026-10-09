import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  getProcurementPermissions,
  listProcurementSuppliers,
  listPurchaseOrders,
  getPurchaseOrder,
  ProcurementAccessError,
} from "@/lib/procurement/server";
import { ProcurementWorkspace } from "@/packages/ui/procurement/workspace";

type Query = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";
const page = (v: string | string[] | undefined) =>
  /^\d{1,5}$/.test(first(v)) ? Math.max(1, Number(first(v))) : 1;
export default async function ProcurementPage({
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
    .enum(["all", "open", "received", "cancelled"])
    .safeParse(first(params.estado));
  const status = statusValue.success ? statusValue.data : "all";
  const orderId = z.uuid().safeParse(first(params.pedido)).success
    ? first(params.pedido)
    : "";
  let data;
  try {
    const [permissions, suppliers, orders, selectedOrder] = await Promise.all([
      getProcurementPermissions(scope),
      listProcurementSuppliers(scope, {
        query,
        page: page(params.fornecedoresPagina),
        pageSize: 100,
      }),
      listPurchaseOrders(scope, { query, status, page: page(params.pagina) }),
      orderId ? getPurchaseOrder(scope, orderId) : Promise.resolve(null),
    ]);
    data = { permissions, suppliers, orders, selectedOrder };
  } catch (error) {
    if (!(error instanceof ProcurementAccessError)) throw error;
    return (
      <section role="alert" className="construction">
        <h1>Compras / Fornecedores</h1>
        <h2>
          {error.kind === "denied"
            ? "Acesso não permitido"
            : "Compras indisponíveis"}
        </h2>
        <p>{error.message}</p>
        {error.kind !== "denied" && (
          <Link href="/app/compras">Tentar novamente</Link>
        )}
      </section>
    );
  }
  return (
    <ProcurementWorkspace
      key={scope.organizationId + scope.storeId}
      scope={scope}
      storeName={access.active.name}
      permissions={data.permissions}
      suppliers={data.suppliers}
      orders={data.orders}
      selectedOrder={data.selectedOrder}
      query={query}
      status={status}
    />
  );
}
