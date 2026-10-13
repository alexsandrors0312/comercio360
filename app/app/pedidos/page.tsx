import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  getOrderDetail,
  getOrderPermissions,
  listOrders,
  OrderAccessError,
} from "@/lib/orders/server";
import { OrdersWorkspace } from "@/packages/ui/orders/workspace";

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";

export default async function OrdersPage({
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
  const orderId = z.uuid().safeParse(first(params.pedido)).success
    ? first(params.pedido)
    : "";
  let data;
  let loadError: OrderAccessError | null = null;
  try {
    const [permissions, orders, selectedOrder] = await Promise.all([
      getOrderPermissions(scope),
      listOrders(scope, { status: "all", page: 1, pageSize: 20 }),
      orderId ? getOrderDetail(scope, orderId) : Promise.resolve(null),
    ]);
    data = { permissions, orders, selectedOrder };
  } catch (error) {
    if (!(error instanceof OrderAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data)
    return (
      <section role="alert" className="construction">
        <h1>Pedidos</h1>
        <h2>
          {loadError?.kind === "denied"
            ? "Acesso não permitido"
            : "Pedidos indisponíveis"}
        </h2>
        <p>{loadError?.message}</p>
        {loadError?.kind !== "denied" && (
          <Link href="/app/pedidos">Tentar novamente</Link>
        )}
      </section>
    );
  return (
    <OrdersWorkspace
      key={data.permissions.userId + scope.organizationId + scope.storeId}
      scope={scope}
      storeName={access.active.name}
      permissions={data.permissions}
      orders={data.orders}
      selectedOrder={data.selectedOrder}
    />
  );
}
