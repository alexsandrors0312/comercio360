"use client";
import type { FormEvent } from "react";
import { brlToCents, type FinanceData, type DeliveryData, type MarketingData } from "../../validation/manual";
import { useManualMutation } from "./mutation";
import styles from "./manual.module.css";

type Scope = { organizationId: string; storeId: string };
type Mutation = ReturnType<typeof useManualMutation>;
const money = (value: string | number) => (Number(value) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const methodLabel: Record<string, string> = { cash: "Dinheiro", pix: "Pix", card: "Cartão", transfer: "Transferência", other: "Outra" };
const deliveryLabel: Record<string, string> = { queued: "Na fila", ready: "Preparado", out_for_delivery: "Saiu para entrega", completed: "Concluído", cancelled: "Cancelado" };
const campaignLabel: Record<string, string> = { draft: "Rascunho", scheduled: "Agendado", completed: "Realizado", cancelled: "Cancelado" };
const channelLabel: Record<string, string> = { store: "Loja", whatsapp: "WhatsApp", instagram: "Instagram", other: "Outro" };
function iso(value: FormDataEntryValue | null) {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : "";
}
function localDateTime(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function Notice({ mutation: m }: { mutation: Mutation }) {
  return <section className={styles.notice} aria-label="Resultado da operação" aria-live="polite">
    {m.storageError && <p role="alert">Armazenamento da aba indisponível. Escritas bloqueadas para preservar o reenvio seguro.</p>}
    {m.message && <p role="status">{m.message}</p>}
    {m.attempt && <><p>Há uma tentativa não confirmada nesta aba. Confira os registros antes de descartá-la.</p>
      <button disabled={m.pending || !m.ready || m.storageError} onClick={() => m.send(m.attempt, true)}>Reenviar mesma tentativa</button>
      <button disabled={m.pending} onClick={m.discard}>Descartar tentativa local</button></>}
  </section>;
}
function Header({ title, storeName, children }: { title: string; storeName: string; children: React.ReactNode }) {
  return <header className={styles.header}><p className="eyebrow">OPERAÇÃO · {storeName}</p><h1>{title}</h1><p>{children}</p></header>;
}
export function FinanceWorkspace({ data, scope, userId, storeName, canManage }: {
  data: FinanceData; scope: Scope; userId: string; storeName: string; canManage: boolean;
}) {
  const m = useManualMutation("finance", userId, `${scope.organizationId}:${scope.storeId}`);
  function receipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    m.send({ module: "finance", scope, key: crypto.randomUUID(), operation: "record", payload: {
      saleId: form.get("saleId"), amountCents: brlToCents(String(form.get("amount") ?? "")),
      method: form.get("method"), note: String(form.get("note") ?? ""),
    } });
  }
  function cash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    m.send({ module: "finance", scope, key: crypto.randomUUID(), operation: "cash", payload: {
      direction: form.get("direction"), amountCents: brlToCents(String(form.get("amount") ?? "")),
      note: form.get("note"),
    } });
  }
  return <div className={styles.workspace}>
    <Header title="Financeiro manual" storeName={storeName}>Registre recebimentos e movimentos de caixa da loja. Os valores são declarações manuais; o sistema não confirma transferência, cartão ou Pix.</Header>
    <Notice mutation={m} />
    <div className={styles.grid}>
      <section className={styles.card}><h2>Caixa registrado</h2><p><strong>{money(data.cashBalanceCents)}</strong></p><small>Recebimentos em dinheiro ativos + entradas manuais − saídas manuais. Não representa saldo bancário nem fechamento conferido.</small></section>
      <section className={styles.card}><h2>Registrar recebimento</h2>
        <form className={styles.form} onSubmit={receipt}>
          <label>Venda<select name="saleId" required>{data.sales.filter(s => s.status === "confirmed" && Number(s.receivedCents ?? "0") < Number(s.totalCents)).map(s =>
            <option key={s.id} value={s.id}>{s.id.slice(0, 8)} · {money(s.totalCents)} · recebido {money(s.receivedCents ?? "0")}</option>)}</select></label>
          <label>Valor em R$<input name="amount" required inputMode="decimal" placeholder="0,00" /></label>
          <label>Forma declarada<select name="method"><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outra</option></select></label>
          <label>Referência opcional<input name="note" maxLength={240} /></label>
          <button disabled={m.disabled || !data.sales.some(s => s.status === "confirmed" && Number(s.receivedCents ?? "0") < Number(s.totalCents))}>Registrar recebimento</button>
        </form>
      </section>
      {canManage && <section className={styles.card}><h2>Entrada ou saída de caixa</h2>
        <form className={styles.form} onSubmit={cash}>
          <label>Movimento<select name="direction"><option value="in">Entrada</option><option value="out">Saída</option></select></label>
          <label>Valor em R$<input name="amount" required inputMode="decimal" placeholder="0,00" /></label>
          <label>Motivo<input name="note" required minLength={3} maxLength={240} /></label>
          <button disabled={m.disabled}>Registrar movimento</button>
        </form>
      </section>}
    </div>
    <div className={styles.grid}>
      <section className={styles.card}><h2>Vendas e recebimentos</h2>
        {data.sales.length === 0 ? <p>Nenhuma venda encontrada nesta loja.</p> : <ul className={styles.list}>{data.sales.map(s => <li className={styles.row} key={s.id}>
          <strong>Venda {s.id.slice(0, 8)} · {money(s.totalCents)}</strong>
          <span>Recebido {money(s.receivedCents ?? "0")} · {s.status === "confirmed" ? "Confirmada" : "Cancelada"}</span>
          {s.status === "cancelled" && Number(s.receivedCents ?? "0") > 0 && <span className={styles.warning}>Recebimento pendente de reconciliação manual.</span>}
          <small>{date(s.createdAt)}</small></li>)}</ul>}
      </section>
      <section className={styles.card}><h2>Últimos recebimentos</h2>
        {data.receipts.length === 0 ? <p>Nenhum recebimento registrado.</p> : <ul className={styles.list}>{data.receipts.map(r => <li className={styles.row} key={r.id}>
          <strong>{money(r.amountCents)} · {methodLabel[r.method] ?? r.method}</strong><span>Venda {r.saleId.slice(0, 8)} · <span className={styles.pill}>{r.status === "posted" ? "Ativo" : "Revertido"}</span></span>
          <small>{date(r.createdAt)} {r.note ? `· ${r.note}` : ""}</small>
          {canManage && r.status === "posted" && <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget);
            m.send({ module: "finance", scope, key: crypto.randomUUID(), operation: "reverse", payload: { receiptId: r.id, reason: form.get("reason") } }); }}>
            <label>Motivo da reversão<input name="reason" required minLength={3} maxLength={240} /></label><button disabled={m.disabled}>Reverter</button></form>}
          {r.reversalReason && <small>Reversão: {r.reversalReason}</small>}
        </li>)}</ul>}
      </section>
      <section className={styles.card}><h2>Movimentos manuais de caixa</h2>
        {data.cashEntries.length === 0 ? <p>Nenhum movimento manual.</p> : <ul className={styles.list}>{data.cashEntries.map(e => <li className={styles.row} key={e.id}>
          <strong>{e.direction === "in" ? "+" : "−"} {money(e.amountCents)}</strong><span>{e.note}</span><small>{date(e.createdAt)}</small>
        </li>)}</ul>}
      </section>
    </div>
  </div>;
}

export function DeliveryWorkspace({ data, scope, userId, storeName }: {
  data: DeliveryData; scope: Scope; userId: string; storeName: string;
}) {
  const m = useManualMutation("deliveries", userId, `${scope.organizationId}:${scope.storeId}`);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    m.send({ module: "deliveries", scope, key: crypto.randomUUID(), operation: "create", payload: {
      saleId: form.get("saleId"), mode: form.get("mode"),
      dueAt: String(form.get("dueAt") ?? "") ? iso(form.get("dueAt")) : null,
      assignedLabel: String(form.get("assignedLabel") ?? ""),
    } });
  }
  return <div className={styles.workspace}>
    <Header title="Entregas e retiradas" storeName={storeName}>Acompanhe manualmente vendas confirmadas. Sem cotação, rastreamento externo, endereço ou contato do cliente nesta etapa.</Header>
    <Notice mutation={m} />
    <section className={styles.card}><h2>Nova entrega ou retirada</h2><form className={styles.form} onSubmit={create}>
      <label>Venda<select name="saleId" required>{data.sales.map(s => <option key={s.id} value={s.id}>{s.id.slice(0, 8)} · {money(s.totalCents)}</option>)}</select></label>
      <label>Modalidade<select name="mode"><option value="pickup">Retirada na loja</option><option value="local_delivery">Entrega local</option></select></label>
      <label>Previsão opcional<input type="datetime-local" name="dueAt" /></label>
      <label>Equipe responsável opcional<input name="assignedLabel" maxLength={120} /></label>
      <button disabled={m.disabled || data.sales.length === 0}>Cadastrar acompanhamento</button>
    </form></section>
    <section className={styles.card}><h2>Acompanhamentos</h2>
      {data.deliveries.length === 0 ? <p>Nenhuma entrega ou retirada cadastrada.</p> : <ul className={styles.list}>{data.deliveries.map(d => {
        const allowed = d.status === "queued" ? ["ready", "cancelled"]
          : d.status === "ready" ? (d.mode === "pickup" ? ["completed", "cancelled"] : ["out_for_delivery", "completed", "cancelled"])
            : d.status === "out_for_delivery" ? ["completed", "cancelled"] : [];
        const labels: Record<string, string> = { ready: "Preparado", out_for_delivery: "Saiu para entrega", completed: "Concluído", cancelled: "Cancelar" };
        return <li className={styles.row} key={d.id}><strong>Venda {d.saleId.slice(0, 8)} · {d.mode === "pickup" ? "Retirada" : "Entrega local"}</strong>
          <span className={styles.pill}>{deliveryLabel[d.status]}</span>
          <small>{d.assignedLabel || "Sem equipe atribuída"}{d.dueAt ? ` · previsão ${date(d.dueAt)}` : ""}</small>
          <div>{allowed.map(next => <button key={next} disabled={m.disabled} onClick={() => m.send({ module: "deliveries", scope,
            key: crypto.randomUUID(), operation: "transition", payload: { id: d.id, revision: d.revision, status: next } })}>{labels[next]}</button>)}</div>
        </li>;
      })}</ul>}
    </section>
  </div>;
}

export function MarketingWorkspace({ data, scope, userId, storeName }: {
  data: MarketingData; scope: Scope; userId: string; storeName: string;
}) {
  const m = useManualMutation("marketing", userId, `${scope.organizationId}:${scope.storeId}`);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    m.send({ module: "marketing", scope, key: crypto.randomUUID(), operation: "create", payload: {
      title: form.get("title"), channel: form.get("channel"), plannedAt: iso(form.get("plannedAt")),
    } });
  }
  return <div className={styles.workspace}>
    <Header title="Calendário de marketing" storeName={storeName}>Planejamento interno de campanhas. Nenhuma mensagem é enviada e nenhuma publicação é feita pelo sistema.</Header>
    <Notice mutation={m} />
    <section className={styles.card}><h2>Planejar campanha</h2><form className={styles.form} onSubmit={create}>
      <label>Título<input name="title" required minLength={3} maxLength={120} /></label>
      <label>Canal planejado<select name="channel"><option value="store">Loja</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="other">Outro</option></select></label>
      <label>Data e hora<input type="datetime-local" name="plannedAt" required /></label>
      <button disabled={m.disabled}>Criar rascunho</button>
    </form></section>
    <section className={styles.card}><h2>Campanhas</h2>
      {data.campaigns.length === 0 ? <p>Nenhuma campanha planejada.</p> : <ul className={styles.list}>{data.campaigns.map(c => <li className={styles.row} key={c.id}>
        <strong>{c.title}</strong><span>{channelLabel[c.channel]} · {date(c.plannedAt)} · <span className={styles.pill}>{campaignLabel[c.status]}</span></span>
        {c.status !== "completed" && c.status !== "cancelled" && <>
          <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget);
            m.send({ module: "marketing", scope, key: crypto.randomUUID(), operation: "update", payload: {
              id: c.id, revision: c.revision, title: form.get("title"), channel: form.get("channel"), plannedAt: iso(form.get("plannedAt")),
            } }); }}>
            <label>Título<input name="title" defaultValue={c.title} required minLength={3} maxLength={120} /></label>
            <label>Canal<select name="channel" defaultValue={c.channel}><option value="store">Loja</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="other">Outro</option></select></label>
            <label>Nova data<input type="datetime-local" name="plannedAt" defaultValue={localDateTime(c.plannedAt)} required /></label>
            <button disabled={m.disabled}>Atualizar</button>
          </form>
          <div>{(c.status === "draft" ? ["scheduled", "cancelled"] : ["completed", "cancelled"]).map(next =>
            <button key={next} disabled={m.disabled} onClick={() => m.send({ module: "marketing", scope, key: crypto.randomUUID(),
              operation: "transition", payload: { id: c.id, revision: c.revision, status: next } })}>
              {next === "scheduled" ? "Agendar" : next === "completed" ? "Marcar realizada" : "Cancelar"}</button>)}</div>
        </>}
      </li>)}</ul>}
    </section>
  </div>;
}
