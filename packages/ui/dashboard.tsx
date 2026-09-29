"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ShoppingCart,
  ReceiptText,
  ClipboardList,
  Boxes,
  CircleAlert,
  CalendarDays,
  Activity,
} from "lucide-react";
import { attention, bars, metrics, recentOrders } from "@/mocks/dashboard";
import { Loading, Empty } from "./states";
import { usePreview } from "./shell";
const metricIcons = [ShoppingCart, ReceiptText, ClipboardList, Boxes];
export function Dashboard() {
  const { base, storeName } = usePreview();
  const [state, setState] = useState("populated");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PANORAMA DA OPERAÇÃO</p>
          <h1>
            Visão Geral<span className="title-dot">.</span>
          </h1>
          <p>
            Veja o dia da <strong>{storeName}</strong> e o que precisa de
            atenção.
          </p>
        </div>
        <div className="date-chip">
          <CalendarDays size={17} />
          05 set. 2026<span>Hoje</span>
        </div>
      </div>
      <div className="demo-notice">
        <div>
          <span className="demo-tag">DEMONSTRAÇÃO</span>
          <span>
            Indicadores e atividades fictícios. Nenhuma operação real é
            executada.
          </span>
        </div>
        <label>
          Visualizar
          <select
            aria-label="Estado da demonstração"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="populated">Com dados</option>
            <option value="loading">Carregando</option>
            <option value="empty">Sem dados</option>
            <option value="error">Erro</option>
          </select>
        </label>
      </div>
      {state === "loading" ? (
        <Loading />
      ) : state === "empty" ? (
        <Empty />
      ) : state === "error" ? (
        <section role="alert" className="center-state">
          <CircleAlert size={36} />
          <h2>Não foi possível carregar os indicadores</h2>
          <p>Este é um exemplo do estado de erro.</p>
          <button className="primary" onClick={() => setState("populated")}>
            Tentar novamente
          </button>
        </section>
      ) : (
        <>
          <div className="metrics">
            {metrics.map((metric, index) => {
              const Icon = metricIcons[index];
              return (
                <article className="metric" key={metric.label}>
                  <div className="metric-top">
                    <span>{metric.label}</span>
                    <Icon size={19} />
                  </div>
                  <strong>{metric.value}</strong>
                  <div className="metric-bottom">
                    <span>{metric.detail}</span>
                    <span className={index < 2 ? "trend" : "metric-tag"}>
                      {index < 2 && <ArrowUpRight size={13} />} {metric.trend}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="overview-grid">
            <section className="panel sales-chart">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RITMO DO DIA</p>
                  <h2>Vendas ao longo do dia</h2>
                </div>
                <span className="legend">
                  <i />
                  Vendas simuladas
                </span>
              </div>
              <div className="chart-summary">
                <strong>
                  R$ 4.860<span>,00</span>
                </strong>
                <span>18 vendas no período</span>
              </div>
              <div
                className="chart"
                role="img"
                aria-label="Gráfico demonstrativo de vendas por horário, com pico às 17h. Não representa valores reais."
              >
                <div className="chart-grid">
                  <span>R$ 1 mil</span>
                  <span>R$ 500</span>
                  <span>R$ 0</span>
                </div>
                <div className="bars">
                  {bars.map((height, i) => (
                    <div
                      className={`bar-wrap ${i === 9 ? "highlight" : ""}`}
                      key={i}
                    >
                      <div className="bar" style={{ height: `${height}%` }} />
                      <span>{String(i + 8).padStart(2, "0")}h</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="chart-footer">
                <Activity size={16} />
                Seu movimento, de hora em hora.
              </div>
            </section>
            <section className="panel attention">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">PRIORIDADES</p>
                  <h2>Precisa de atenção</h2>
                </div>
                <span className="count">3</span>
              </div>
              {attention.map((a) => (
                <Link
                  className="attention-item"
                  key={a.slug}
                  href={`${base}/${a.slug}`}
                >
                  <span className={`alert-icon ${a.tone}`}>
                    <CircleAlert size={19} />
                  </span>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.detail}</p>
                    <span className="attention-label">
                      {a.label} <ArrowRight size={13} />
                    </span>
                  </div>
                </Link>
              ))}
            </section>
          </div>
          <div className="bottom-grid">
            <section className="panel orders">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">ÚLTIMAS ATIVIDADES</p>
                  <h2>Pedidos recentes</h2>
                </div>
                <Link href={`${base}/pedidos`} className="panel-link">
                  Ver pedidos <ArrowUpRight size={15} />
                </Link>
              </div>
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    Pedidos fictícios recentes
                  </caption>
                  <thead>
                    <tr>
                      <th>Pedido / Cliente</th>
                      <th>Canal</th>
                      <th>Valor</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.id}</strong>
                          <small>{o.customer}</small>
                        </td>
                        <td>{o.channel}</td>
                        <td className="amount">{o.amount}</td>
                        <td>
                          <span
                            className={`badge ${o.state === "Concluído" ? "green" : o.state === "Aguardando" ? "amber" : "blue"}`}
                          >
                            {o.state}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="quick-panel">
              <span className="quick-icon">
                <ArrowUpRight size={25} />
              </span>
              <p className="eyebrow">ACESSO RÁPIDO</p>
              <h2>
                Seu próximo passo,
                <br />a um clique.
              </h2>
              <p>Explore os espaços que vão acompanhar a rotina da sua loja.</p>
              <Link href={`${base}/produtos`}>
                Consultar produtos <ArrowRight size={17} />
              </Link>
              <Link href={`${base}/estoque`}>
                Acompanhar estoque <ArrowRight size={17} />
              </Link>
              <small>Módulos em construção</small>
            </section>
          </div>
        </>
      )}
    </>
  );
}
