import Link from "next/link";
import type { OperationsOverview as Overview, ReadSection } from "../../domain/operations-contracts";
import { formatSaleMoney } from "../../domain/sales";
import styles from "./operations.module.css";

function Count({ label, source, href }: { label: string; source: ReadSection<{ total: number }>; href: string }) {
  if (source.status === "hidden") return null;
  return <article className={styles.card} aria-label={label}>
    <h2>{label}</h2>
    {source.status === "ready"
      ? <p className={styles.number}>{source.data.total.toLocaleString("pt-BR")}</p>
      : <p role="status">Consulta indisponível</p>}
    <Link href={href}>Consultar</Link>
  </article>;
}

export function OperationsOverview({ data, storeName }: { data: Overview; storeName: string }) {
  return <div className={styles.workspace}>
    <header><p className="eyebrow">OPERAÇÃO · {storeName}</p><h1>Visão Geral</h1>
      <p>Loja selecionada: <strong>{storeName}</strong>. Resumo dos registros considerando todo o histórico.</p></header>
    <p className={styles.notice}>Ambiente de desenvolvimento com dados fictícios. As consultas usam os registros cadastrados e podem observar instantes diferentes. Contagens de vendas não representam pagamentos recebidos.</p>
    <div className={styles.metrics}>
      <Count label="Vendas confirmadas" source={data.sales} href="/app/relatorios?tipo=sales&estado=confirmed" />
      <Count label="Pedidos abertos" source={data.orders} href="/app/pedidos" />
      <Count label="SKUs consultáveis" source={data.stock} href="/app/relatorios?tipo=stock" />
    </div>
    {data.sales.status === "ready" && <section className={styles.card} aria-label="Últimas vendas confirmadas">
      <h2>Últimas cinco vendas confirmadas</h2>
      {data.sales.data.items.length === 0 ? <p>Nenhuma venda confirmada nesta loja.</p> : <ul className={styles.list}>
        {data.sales.data.items.map((sale) => <li key={sale.id}>
          <Link href={`/app/pdv?venda=${sale.id}`}>Venda {sale.id}</Link>
          <span>{formatSaleMoney(sale.totalCents)} · {new Date(sale.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
        </li>)}
      </ul>}
    </section>}
    <section className={styles.card}><h2>Consultas da operação</h2><p>Veja os registros e seus detalhes sem alterar saldo ou vendas.</p>
      <Link href="/app/relatorios">Abrir Relatórios</Link>
    </section>
  </div>;
}
