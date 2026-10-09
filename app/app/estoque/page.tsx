import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  getInventoryAccess,
  getInventoryItem,
  listInventoryHistory,
  listInventoryStock,
  InventoryAccessError,
} from "@/lib/inventory/server";
import { InventoryWorkspace } from "@/packages/ui/inventory/workspace";

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
const pageNumber = (value: string | string[] | undefined) =>
  /^\d{1,5}$/.test(first(value)) ? Math.max(1, Number(first(value))) : 1;

export default async function InventoryPage({
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
  const selectedId = z.uuid().safeParse(first(params.variante)).success
    ? first(params.variante)
    : "";
  let data;
  try {
    const [permission, stock, selectedItem, history] = await Promise.all([
      getInventoryAccess(scope),
      listInventoryStock(scope, { query, page: pageNumber(params.pagina) }),
      selectedId ? getInventoryItem(scope, selectedId) : Promise.resolve(null),
      selectedId
        ? listInventoryHistory(scope, selectedId, pageNumber(params.historico))
        : Promise.resolve(null),
    ]);
    data = { permission, stock, selectedItem, history };
  } catch (error) {
    if (!(error instanceof InventoryAccessError)) throw error;
    return (
      <section role="alert" className="construction">
        <h1>Estoque</h1>
        <h2>
          {error.kind === "denied"
            ? "Acesso não permitido"
            : "Estoque indisponível"}
        </h2>
        <p>{error.message}</p>
        {error.kind !== "denied" && (
          <Link href="/app/estoque">Tentar novamente</Link>
        )}
      </section>
    );
  }
  return (
    <InventoryWorkspace
      key={scope.organizationId + scope.storeId}
      scope={scope}
      storeName={access.active.name}
      stock={data.stock}
      selectedItem={data.selectedItem}
      history={data.history}
      query={query}
      canWrite={data.permission.canWrite}
    />
  );
}
