import Link from "next/link";
import { z } from "zod";
import { requireAccess } from "@/lib/tenancy";
import {
  CatalogAccessError,
  getCatalogAccess,
  getCatalogProduct,
  listCatalogCategories,
  listCatalogProducts,
  type CatalogFilters,
} from "@/lib/catalog/server";
import { CatalogWorkspace } from "@/packages/ui/catalog/workspace";
import styles from "./catalog.module.css";

type Query = Record<string, string | string[] | undefined>;
type CatalogData = {
  canWrite: boolean;
  categories: Awaited<ReturnType<typeof listCatalogCategories>>;
  products: Awaited<ReturnType<typeof listCatalogProducts>>;
  product: Awaited<ReturnType<typeof getCatalogProduct>>;
};
function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const access = await requireAccess();
  const scope = {
    organizationId: access.active.organization_id,
    storeId: access.active.id,
  };
  const query = await searchParams;
  const q = first(query.q).slice(0, 200);
  const status = first(query.estado);
  const filters: CatalogFilters = {
    query: q,
    categoryId: z.uuid().safeParse(first(query.categoria)).success
      ? first(query.categoria)
      : null,
    status: status === "inactive" || status === "all" ? status : "active",
    page: /^\d{1,5}$/.test(first(query.pagina))
      ? Math.max(1, Number(first(query.pagina)))
      : 1,
    pageSize: 12,
  };
  const selectedId = first(query.produto);
  let data: CatalogData | null = null;
  let loadError: CatalogAccessError | null = null;

  try {
    const permission = await getCatalogAccess(scope);
    const [categories, products, product] = await Promise.all([
      listCatalogCategories(scope),
      listCatalogProducts(scope, filters),
      selectedId && z.uuid().safeParse(selectedId).success
        ? getCatalogProduct(scope, selectedId)
        : Promise.resolve(null),
    ]);
    data = { canWrite: permission.canWrite, categories, products, product };
  } catch (error) {
    if (!(error instanceof CatalogAccessError)) throw error;
    loadError = error;
  }

  if (loadError) {
    return (
      <section className={styles.state} role="alert">
        <h1>Produtos</h1>
        <h2>
          {loadError.kind === "denied"
            ? "Acesso não permitido"
            : "Catálogo indisponível"}
        </h2>
        <p>
          {loadError.kind === "denied"
            ? "Seu acesso atual não permite consultar o catálogo desta empresa e loja."
            : loadError.message}
        </p>
        {loadError.kind !== "denied" && (
          <Link href="/app/produtos">Tentar novamente</Link>
        )}
      </section>
    );
  }
  if (!data) throw new Error("Catálogo sem resultado de leitura.");
  return (
    <CatalogWorkspace
      scope={scope}
      storeName={access.active.name}
      categories={data.categories}
      products={data.products}
      product={data.product}
      selectedId={selectedId}
      filters={{
        query: q,
        categoryId: filters.categoryId ?? null,
        status: filters.status ?? "active",
      }}
      canWrite={data.canWrite}
    />
  );
}
