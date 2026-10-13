import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { getOperationsReport, OperationsReadError } from "@/lib/operations/server";
import type { OperationsReport } from "@/packages/domain/operations-contracts";
import { formatSaleMoney } from "@/packages/domain/sales";
import styles from "@/packages/ui/operations/operations.module.css";

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const saleStatus = { confirmed: "Confirmada", cancelled: "Cancelada" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  const role = access.memberships.find((member) => member.organization_id === scope.organizationId)?.role;
  const commercial = !!role && ["owner", "manager", "cashier"].includes(role);
  const params = await searchParams;
  const input = {
    type: first(params.tipo) ?? (commercial ? "sales" : "stock"),
    status: first(params.estado) ?? "all",
    query: first(params.q) ?? "",
    page: first(params.pagina) ?? "1",
  };
  let report: OperationsReport;
  try {
    report = await getOperationsReport(scope, input);
  } catch (error) {
    if (!(error instanceof OperationsReadError)) throw error;
    return <section role="alert" className={styles.workspace}><h1>Relatórios</h1>
      <h2>{error.kind === "denied" ? "Acesso não permitido" : error.kind === "invalid" ? "Filtro inválido" : "Relatório indisponível"}</h2>
      <p>{error.message}</p><Link href="/app/relatorios">Voltar às consultas permitidas</Link>
    </section>;
  }
  const page = report.page;
  const pageHref = (number: number) => `/app/relatorios?${new URLSearchParams({ tipo: report.type, estado: input.status, q: input.query, pagina: String(number) })}`;
  return <div className={styles.workspace}>
    <header><p className="eyebrow">CONSULTAS · {access.active.name}</p><h1>Relatórios</h1>
      <p>Registros de todo o histórico da loja selecionada. Ambiente fictício; valores de venda não comprovam recebimento.</p></header>
    <section className={styles.card}>
      <form key={JSON.stringify(input)} method="get" action="/app/relatorios" className={styles.filters} aria-label="Filtrar relatório">
        <label className={styles.field}><span>Consulta</span><select aria-label="Consulta" name="tipo" defaultValue={report.type}>
          {commercial && <option value="sales">Vendas</option>}<option value="stock">Estoque</option>
        </select></label>
        <label className={styles.field}>Estado da venda<select name="estado" defaultValue={input.status}>
          <option value="all">Todos</option><option value="confirmed">Confirmadas</option><option value="cancelled">Canceladas</option>
        </select></label>
        <label className={styles.field}>Produto ou SKU (consulta de estoque)<input name="q" maxLength={200} defaultValue={input.query} /></label>
        <button className={styles.button}>Consultar relatório</button>
      </form>
      <p>Estado se aplica a vendas; produto/SKU se aplica a estoque. Cada consulta usa seus próprios filtros.</p>
    </section>
    <section className={styles.card} aria-label="Resultado do relatório">
      <h2>{report.type === "sales" ? "Vendas registradas" : "Saldos por SKU"}</h2>
      <p>{page.total.toLocaleString("pt-BR")} registros encontrados</p>
      {page.items.length === 0 && <p>Nenhum registro nesta página e filtro.</p>}
      <ul className={styles.list}>
        {report.type === "sales" ? report.page.items.map((sale) => <li key={sale.id}>
          <Link href={`/app/pdv?venda=${sale.id}`}>Venda {sale.id}</Link>
          <span>{saleStatus[sale.status]} · Total registrado: {formatSaleMoney(sale.totalCents)}</span>
          <span>{new Date(sale.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
        </li>) : report.page.items.map((item) => <li key={item.variantId}>
          <Link href={`/app/estoque?variante=${item.variantId}`}>{item.productName} · SKU {item.sku}</Link>
          <span>{item.active ? "Ativo" : "Inativo"} · {item.quantity.toLocaleString("pt-BR")} unidades</span>
        </li>)}
      </ul>
      <nav className={styles.pagination} aria-label="Paginação do relatório">
        {page.page > 1 && <Link href={pageHref(page.page - 1)}>Página anterior</Link>}
        <span>Página {page.page} de {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
        {page.page * page.pageSize < page.total && <Link href={pageHref(page.page + 1)}>Próxima página</Link>}
      </nav>
    </section>
  </div>;
}
