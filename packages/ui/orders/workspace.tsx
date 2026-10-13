"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { createOrder, cancelOrder, fulfillOrder, searchOrders } from "@/app/actions/orders";
import { findCustomers } from "@/app/actions/customers";
import { findSaleVariants } from "@/app/actions/sales";
import type { Customer } from "@/packages/domain/customers-contracts";
import type { SaleVariant } from "@/packages/domain/sales-contracts";
import type {
  OrderChannel,
  OrderDetail,
  OrderPage,
  OrderPermissions,
  OrderResult,
  OrderScope,
  OrderStatus,
} from "@/packages/domain/orders-contracts";
import { calculateOrderTotal, MAX_ORDER_LINES } from "@/packages/domain/orders";
import { parseInventoryQuantity } from "@/packages/domain/inventory";
import { formatSaleMoney } from "@/packages/domain/sales";
import { useHydrated } from "@/packages/ui/use-hydrated";
import {
  clearOrderAttempt,
  loadOrderAttempt,
  orderAttemptKey,
  parseOrderAttempt,
  persistOrderAttempt,
  type OrderAttempt,
} from "./attempt";
import styles from "@/app/app/pedidos/orders.module.css";

type Props = {
  scope: OrderScope;
  storeName: string;
  permissions: OrderPermissions;
  orders: OrderPage;
  selectedOrder: OrderDetail | null;
};
type Filter = "all" | OrderStatus;
type DraftLine = SaleVariant & { units: string };
const statusLabel: Record<OrderStatus, string> = {
  open: "Aberto",
  fulfilled: "Concluído em venda",
  cancelled: "Cancelado",
};
const channelLabel: Record<OrderChannel, string> = {
  counter: "Balcão",
  whatsapp: "WhatsApp manual",
};
const detailHref = (id: string) => `/app/pedidos?pedido=${encodeURIComponent(id)}`;

function useOrderMutation(
  scope: OrderScope,
  userId: string,
  onSuccess: (id: string) => void,
  focusNotice: () => void,
) {
  const hydrated = useHydrated();
  const key = orderAttemptKey(scope, userId);
  const [readyKey, setReadyKey] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<OrderAttempt | null>(null);
  const [notice, setNotice] = useState<OrderResult | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const recovered = loadOrderAttempt(sessionStorage, key);
        uncertain.current = recovered !== null;
        setAttempt(recovered);
        setStorageError(false);
        setReadyKey(key);
      } catch {
        setStorageError(true);
        setReadyKey(key);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  const ready = hydrated && readyKey === key && !storageError;
  function send(value: OrderAttempt, retry = false) {
    if (!ready || locked.current || (!retry && attempt !== null)) return;
    try {
      parseOrderAttempt(value);
    } catch {
      setNotice({ status: "invalid", message: "Confira o cliente, os itens, as quantidades e o motivo." });
      focusNotice();
      return;
    }
    try {
      persistOrderAttempt(sessionStorage, key, value);
    } catch {
      setStorageError(true);
      focusNotice();
      return;
    }
    locked.current = true;
    setAttempt(value);
    setNotice(null);
    startTransition(async () => {
      let result: OrderResult;
      try {
        result = value.kind === "create"
          ? await createOrder(scope, value.payload)
          : value.kind === "cancel"
            ? await cancelOrder(scope, value.payload)
            : await fulfillOrder(scope, value.payload);
      } catch {
        result = {
          status: "unavailable",
          message: "Não foi possível confirmar o resultado. Confirme o envio anterior com os mesmos dados para evitar duplicidade.",
        };
      }
      const keep = result.status === "unavailable" ||
        (result.status === "denied" && uncertain.current);
      if (keep) uncertain.current = true;
      else {
        try {
          clearOrderAttempt(sessionStorage, key);
          setAttempt(null);
          uncertain.current = false;
        } catch {
          setStorageError(true);
        }
      }
      setNotice(result);
      locked.current = false;
      if (result.status === "success") onSuccess(result.id);
      focusNotice();
    });
  }
  return {
    ready, pending, attempt, notice, storageError,
    disabled: !ready || pending || attempt !== null,
    send,
    retry: () => { if (attempt) send(attempt, true); },
  };
}
type Mutation = ReturnType<typeof useOrderMutation>;

function OrderBuilder({ scope, mutation }: { scope: OrderScope; mutation: Mutation }) {
  const [channel, setChannel] = useState<OrderChannel>("counter");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [variants, setVariants] = useState<SaleVariant[]>([]);
  const [variantSearched, setVariantSearched] = useState(false);
  const [variantNotice, setVariantNotice] = useState("");
  const [variantPending, startVariantSearch] = useTransition();
  const variantLocked = useRef(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearched, setCustomerSearched] = useState(false);
  const [customerNotice, setCustomerNotice] = useState("");
  const [customerPending, startCustomerSearch] = useTransition();
  const customerLocked = useRef(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const total = calculateOrderTotal(lines.map((line) => ({
    quantity: parseInventoryQuantity(line.units) ?? 0,
    expectedUnitPriceCents: line.unitPriceCents ?? -1,
  })));
  const customerReady = channel === "counter" ||
    (selectedCustomer !== null && selectedCustomer.active && !!selectedCustomer.phone);

  function searchVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutation.ready || variantLocked.current) return;
    const query = String(new FormData(event.currentTarget).get("variantQuery") ?? "");
    variantLocked.current = true;
    setVariantNotice("");
    startVariantSearch(async () => {
      try {
        const result = await findSaleVariants(scope, query);
        if (result.status === "success") {
          setVariants(result.items);
          setVariantSearched(true);
        } else {
          setVariants([]);
          setVariantNotice(result.message);
        }
      } catch {
        setVariants([]);
        setVariantNotice("Não foi possível buscar SKUs. Tente novamente.");
      }
      variantLocked.current = false;
    });
  }
  function searchCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutation.ready || customerLocked.current) return;
    const query = String(new FormData(event.currentTarget).get("customerQuery") ?? "");
    customerLocked.current = true;
    setCustomerNotice("");
    startCustomerSearch(async () => {
      try {
        const result = await findCustomers(scope, query);
        if (result.status === "success") {
          setCustomers(result.items.filter((item) => item.active));
          setCustomerSearched(true);
        } else {
          setCustomers([]);
          setCustomerNotice(result.message);
        }
      } catch {
        setCustomers([]);
        setCustomerNotice("Não foi possível buscar clientes. Tente novamente.");
      }
      customerLocked.current = false;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (total === null || !customerReady || !data.has("reviewed")) return;
    mutation.send({
      kind: "create",
      payload: {
        channel,
        customerId: selectedCustomer?.id ?? null,
        items: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.units,
          expectedUnitPriceCents: line.unitPriceCents!,
        })),
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }
  return (
    <section className={styles.card} aria-label="Capturar pedido">
      <h2>Novo pedido</h2>
      <p className={styles.muted}>Captura manual, sem reserva de estoque. A conclusão revalida preço e saldo e confirma uma venda.</p>
      <div className={styles.stack}>
        <label className={styles.field}>
          <span>Origem do pedido</span>
          <select value={channel} disabled={mutation.disabled} onChange={(event) => setChannel(event.target.value as OrderChannel)}>
            <option value="counter">Balcão</option>
            <option value="whatsapp">WhatsApp registrado manualmente</option>
          </select>
        </label>
        <p className={styles.meta}>O marcador WhatsApp não envia mensagem nem registra conversa.</p>
        <form role="search" aria-label="Buscar SKUs para pedido" className={styles.filters} aria-busy={variantPending} onSubmit={searchVariant}>
          <label className={styles.field}><span>Buscar variante por produto, SKU ou código de barras</span>
            <input name="variantQuery" maxLength={200} disabled={!mutation.ready || variantPending} /></label>
          <button className={styles.secondary} disabled={!mutation.ready || variantPending}>{variantPending ? "Buscando…" : "Buscar SKU"}</button>
        </form>
        {variantNotice && <p role="alert">{variantNotice}</p>}
        {variantSearched && variants.length === 0 && <p role="status">Nenhum SKU ativo encontrado.</p>}
        {variants.length > 0 && <ul className={styles.list} aria-label="Resultados de SKUs">
          {variants.map((variant) => <li key={variant.variantId} className={styles.line}>
            <strong>{variant.productName} · {variant.sku}</strong>
            <span className={styles.meta}>{variant.unitPriceCents === null ? "Sem preço nesta loja" : formatSaleMoney(variant.unitPriceCents)} · Saldo consultado: {variant.quantity}</span>
            <button className={styles.secondary} type="button" aria-label={`Adicionar ${variant.sku}`} disabled={mutation.disabled || variant.unitPriceCents === null || lines.length >= MAX_ORDER_LINES || lines.some((line) => line.variantId === variant.variantId)} onClick={() => setLines((current) => [...current, { ...variant, units: "1" }])}>Adicionar</button>
          </li>)}</ul>}
        <form role="search" aria-label="Buscar cliente para pedido" className={styles.filters} aria-busy={customerPending} onSubmit={searchCustomer}>
          <label className={styles.field}><span>Buscar cliente por nome, telefone ou e-mail</span>
            <input name="customerQuery" maxLength={200} disabled={!mutation.ready || customerPending} /></label>
          <button className={styles.secondary} disabled={!mutation.ready || customerPending}>{customerPending ? "Buscando…" : "Buscar cliente"}</button>
        </form>
        <p className={styles.meta}>No balcão, cliente é opcional. Para WhatsApp, selecione cliente ativo com telefone cadastrado.</p>
        {customerNotice && <p role="alert">{customerNotice}</p>}
        {customerSearched && customers.length === 0 && <p role="status">Nenhum cliente ativo encontrado.</p>}
        {customers.length > 0 && <ul className={styles.list} aria-label="Resultados de clientes">
          {customers.map((customer) => <li key={customer.id} className={styles.line}>
            <strong>{customer.name}</strong>
            <span className={styles.meta}>{customer.phone ? "Telefone cadastrado" : "Sem telefone cadastrado"}</span>
            <button type="button" className={styles.secondary} aria-label={`Selecionar cliente ${customer.name}`} disabled={mutation.disabled || (channel === "whatsapp" && !customer.phone)} onClick={() => setSelectedCustomer(customer)}>Selecionar</button>
          </li>)}</ul>}
        {selectedCustomer && <p className={styles.total}>Cliente selecionado: <strong>{selectedCustomer.name}</strong>{" "}
          <button type="button" className={styles.linkButton} disabled={mutation.disabled} onClick={() => setSelectedCustomer(null)}>Remover cliente</button>
        </p>}
        <form aria-label="Criar pedido" aria-busy={mutation.pending} className={styles.stack} onSubmit={submit}>
          <fieldset disabled={mutation.disabled}>
            <legend>Itens do pedido</legend>
            {lines.length === 0 && <p className={styles.empty}>Adicione um SKU com preço nesta loja.</p>}
            <ul className={styles.list}>{lines.map((line) => <li key={line.variantId} className={styles.line}>
              <strong>{line.productName} · {line.sku}</strong>
              <span>Preço unitário: {formatSaleMoney(line.unitPriceCents!)}</span>
              <label className={styles.field}><span>Quantidade {line.sku}</span>
                <input inputMode="numeric" pattern="[0-9]+" maxLength={7} required value={line.units} onChange={(event) => setLines((current) => current.map((item) => item.variantId === line.variantId ? { ...item, units: event.target.value } : item))} /></label>
              <button type="button" className={styles.linkButton} onClick={() => setLines((current) => current.filter((item) => item.variantId !== line.variantId))}>Remover {line.sku}</button>
            </li>)}</ul>
            <p className={styles.total}>Total proposto: <strong>{total === null ? "Confira itens e quantidades" : formatSaleMoney(total)}</strong></p>
            {!customerReady && <p role="alert">Pedido de WhatsApp exige cliente ativo com telefone cadastrado.</p>}
            <label className={styles.check}><input type="checkbox" name="reviewed" required />Conferi os itens, as quantidades e os preços do pedido</label>
          </fieldset>
          <button className={styles.primary} disabled={mutation.disabled || total === null || !customerReady}>{mutation.pending ? "Registrando…" : "Registrar pedido"}</button>
        </form>
      </div>
    </section>
  );
}

function OrderDetails({ detail, permissions, mutation }: { detail: OrderDetail | null; permissions: OrderPermissions; mutation: Mutation }) {
  if (!detail) return <section className={styles.card}><h2>Selecione um pedido</h2><p>Consulte itens, origem e estado do atendimento.</p></section>;
  const { order, items } = detail;
  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.send({ kind: "cancel", payload: {
      orderId: order.id, expectedRevision: order.revision,
      reason: String(new FormData(event.currentTarget).get("reason") ?? ""),
      idempotencyKey: crypto.randomUUID(),
    }});
  }
  function fulfill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!new FormData(event.currentTarget).has("reviewed")) return;
    mutation.send({ kind: "fulfill", payload: {
      orderId: order.id, expectedRevision: order.revision,
      idempotencyKey: crypto.randomUUID(),
    }});
  }
  return <section className={styles.card} aria-label="Detalhes do pedido">
    <h2>Pedido {order.id}</h2>
    <span className={styles.status}>{statusLabel[order.status]}</span>
    <p>Origem: {channelLabel[order.channel]}</p>
    <p>Criado em {new Date(order.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
    <p>Cliente registrado: {order.customerNameSnapshot ?? "Não informado"}</p>
    <ul className={styles.list} aria-label="Itens do pedido">{items.map((item) => <li key={item.variantId} className={styles.line}>
      <strong>{item.productName} · {item.sku}</strong>
      <span>{item.quantity} unidades × {formatSaleMoney(item.unitPriceCents)}</span>
    </li>)}</ul>
    <p className={styles.total}>Total registrado: <strong>{formatSaleMoney(order.totalCents)}</strong></p>
    {order.saleId && <p>Venda criada: <Link href={`/app/pdv?venda=${encodeURIComponent(order.saleId)}`}>{order.saleId}</Link></p>}
    {order.cancellationReason && <p>Motivo do cancelamento: {order.cancellationReason}</p>}
    {order.status === "open" && permissions.canFulfill && <form className={styles.stack} aria-label="Concluir pedido em venda" aria-busy={mutation.pending} onSubmit={fulfill}>
      <fieldset disabled={mutation.disabled}>
        <legend>Concluir em venda</legend>
        <p>O preço e o estoque serão revalidados. O pedido não é editável; preço alterado exige cancelar e refazer.</p>
        <label className={styles.check}><input type="checkbox" name="reviewed" required />Conferi os itens e vou confirmar a venda com baixa de estoque</label>
      </fieldset>
      <button className={styles.primary} disabled={mutation.disabled}>{mutation.pending ? "Concluindo…" : "Concluir pedido em venda"}</button>
    </form>}
    {order.status === "open" && permissions.canCancel && <form className={styles.stack} aria-label="Cancelar pedido" aria-busy={mutation.pending} onSubmit={cancel}>
      <fieldset disabled={mutation.disabled}>
        <legend>Cancelar pedido</legend>
        <label className={styles.field}><span>Motivo do cancelamento</span><textarea name="reason" required minLength={3} maxLength={240} rows={3} /></label>
      </fieldset>
      <button className={styles.danger} disabled={mutation.disabled}>{mutation.pending ? "Cancelando…" : "Cancelar pedido"}</button>
    </form>}
  </section>;
}

export function OrdersWorkspace({ scope, storeName, permissions, orders, selectedOrder }: Props) {
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);
  const [builderRevision, setBuilderRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState<OrderPage>(orders);
  const [previousOrders, setPreviousOrders] = useState(orders);
  const [listNotice, setListNotice] = useState("");
  const [listPending, startList] = useTransition();
  const listLocked = useRef(false);
  if (orders !== previousOrders) {
    setPreviousOrders(orders);
    setPage(orders);
    setFilter("all");
  }
  const mutation = useOrderMutation(scope, permissions.userId, (id) => {
    setBuilderRevision((value) => value + 1);
    router.push(detailHref(id));
    router.refresh();
  }, () => requestAnimationFrame(() => noticeRef.current?.focus()));
  function load(status: Filter, nextPage: number) {
    if (listLocked.current) return;
    listLocked.current = true;
    setListNotice("");
    startList(async () => {
      try {
        const result = await searchOrders(scope, { status, page: nextPage, pageSize: 20 });
        if (result.status === "success") { setPage(result.page); setFilter(status); }
        else setListNotice(result.message);
      } catch { setListNotice("Não foi possível consultar pedidos. Tente novamente."); }
      listLocked.current = false;
    });
  }
  return <div className={styles.workspace}>
    <header className={styles.heading}><p className={styles.eyebrow}>OPERAÇÕES · {storeName}</p><h1>Pedidos</h1>
      <p>Pedidos manuais de balcão e WhatsApp, separados da venda e do estoque.</p></header>
    <noscript>Ative o JavaScript para registrar, cancelar ou concluir pedidos com segurança.</noscript>
    <div ref={noticeRef} tabIndex={-1} className={mutation.notice || mutation.attempt || mutation.storageError ? styles.notice : undefined}
      role={mutation.notice?.status === "success" ? "status" : "alert"} aria-live={mutation.notice?.status === "success" ? "polite" : "assertive"}>
      {mutation.storageError && <p>O armazenamento desta aba está indisponível ou contém uma tentativa inválida. Nenhuma nova operação será enviada. Recupere o armazenamento e recarregue a página.</p>}
      {mutation.notice && <p>{mutation.notice.message}</p>}
      {mutation.notice?.status === "conflict" && <Link href="/app/pedidos">Atualizar e revisar pedido, preço e saldo</Link>}
      {mutation.notice?.status === "insufficient" && <p>O pedido continua aberto; nenhuma venda ou baixa foi confirmada.</p>}
      {mutation.attempt && <>
        <h2>Envio anterior pendente de confirmação</h2>
        <p>Os dados e a chave desta tentativa estão preservados nesta aba por usuário, empresa e loja. Confirme o mesmo envio antes de iniciar outro.</p>
        {mutation.attempt.kind === "create" ? <><p>Origem: {channelLabel[mutation.attempt.payload.channel]}; cliente: {mutation.attempt.payload.customerId ?? "não informado"}</p>
          <ul>{mutation.attempt.payload.items.map((item) => <li key={item.variantId}>{item.variantId}: {item.quantity} × {formatSaleMoney(item.expectedUnitPriceCents)}</li>)}</ul></>
          : <p>{mutation.attempt.kind === "cancel" ? "Cancelamento" : "Conclusão"} do pedido {mutation.attempt.payload.orderId}{mutation.attempt.kind === "cancel" ? `: ${mutation.attempt.payload.reason}` : ""}</p>}
        <button type="button" className={styles.primary} disabled={!mutation.ready || mutation.pending} onClick={mutation.retry}>{mutation.pending ? "Confirmando envio…" : "Confirmar envio anterior"}</button>
      </>}
    </div>
    {permissions.canCreate && <OrderBuilder key={builderRevision} scope={scope} mutation={mutation} />}
    <section className={styles.card} aria-label="Consulta de pedidos">
      <form role="search" aria-label="Filtrar pedidos" className={styles.filters} aria-busy={listPending} onSubmit={(event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("status"); if (value === "all" || value === "open" || value === "fulfilled" || value === "cancelled") load(value, 1); }}>
        <label className={styles.field}><span>Estado do pedido</span><select key={filter} name="status" defaultValue={filter} disabled={listPending}>
          <option value="all">Todos</option><option value="open">Abertos</option><option value="fulfilled">Concluídos</option><option value="cancelled">Cancelados</option>
        </select></label>
        <button className={styles.secondary} disabled={listPending}>{listPending ? "Carregando…" : "Filtrar pedidos"}</button>
      </form>
      {listNotice && <p role="alert">{listNotice}</p>}
      <div className={styles.columns}>
        <section aria-label="Lista de pedidos">
          <h2>Pedidos desta loja</h2>
          {page.items.length === 0 ? <p className={styles.empty}>Nenhum pedido neste filtro.</p> : <ul className={styles.list}>{page.items.map((order) => <li key={order.id}>
            <Link className={`${styles.listRow} ${selectedOrder?.order.id === order.id ? styles.selected : ""}`} aria-current={selectedOrder?.order.id === order.id ? "page" : undefined} href={detailHref(order.id)}>
              <strong>Pedido {order.id}</strong><span>{channelLabel[order.channel]} · {statusLabel[order.status]}</span>
              <span className={styles.meta}>{order.itemCount} itens · {formatSaleMoney(order.totalCents)}</span>
            </Link></li>)}</ul>}
          <nav className={styles.pagination} aria-label="Paginação de pedidos">
            <button type="button" className={styles.secondary} disabled={listPending || page.page <= 1} onClick={() => load(filter, page.page - 1)}>Página anterior</button>
            <span>Página {page.page} de {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
            <button type="button" className={styles.secondary} disabled={listPending || page.page * page.pageSize >= page.total} onClick={() => load(filter, page.page + 1)}>Próxima página</button>
          </nav>
        </section>
        <OrderDetails detail={selectedOrder} permissions={permissions} mutation={mutation} />
      </div>
    </section>
  </div>;
}
