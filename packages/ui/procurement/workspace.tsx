"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type RefObject,
} from "react";
import {
  saveProcurementSupplier,
  createPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  findPurchaseVariants,
} from "@/app/actions/procurement";
import type {
  ProcurementScope,
  ProcurementPermissions,
  ProcurementResult,
  Supplier,
  SupplierInput,
  SupplierPage,
  PurchasePage,
  PurchaseDetail,
  PurchaseStatus,
  ProcurementVariant,
  PurchaseInput,
  PurchaseTransitionInput,
  PurchaseCancelInput,
} from "@/packages/domain/procurement-contracts";
import {
  calculatePurchaseTotal,
  formatPurchaseMoney,
  MAX_PURCHASE_LINES,
  parsePurchaseUnitCost,
} from "@/packages/domain/procurement";
import { parseInventoryQuantity } from "@/packages/domain/inventory";
import styles from "@/app/app/compras/procurement.module.css";

type Props = {
  scope: ProcurementScope;
  storeName: string;
  permissions: ProcurementPermissions;
  suppliers: SupplierPage;
  orders: PurchasePage;
  selectedOrder: PurchaseDetail | null;
  query: string;
  status: "all" | PurchaseStatus;
};
const statusLabel = {
  open: "Aberto",
  received: "Recebido",
  cancelled: "Cancelado",
};

function hrefFor(
  query: string,
  status: Props["status"],
  page = 1,
  suppliersPage = 1,
  orderId = "",
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status !== "all") params.set("estado", status);
  if (page > 1) params.set("pagina", String(page));
  if (suppliersPage > 1)
    params.set("fornecedoresPagina", String(suppliersPage));
  if (orderId) params.set("pedido", orderId);
  return "/app/compras" + (params.size ? "?" + params.toString() : "");
}

function useMutation<T>(task: (input: T) => Promise<ProcurementResult>) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<ProcurementResult | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const locked = useRef(false);
  const attempt = useRef<T | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const blocked = notice?.status === "conflict" || notice?.status === "denied";
  function run(
    factory: () => T,
    success?: (
      result: Extract<ProcurementResult, { status: "success" }>,
    ) => void,
  ) {
    if (locked.current || blocked) return;
    if (attempt.current === null) attempt.current = factory();
    const input = attempt.current;
    locked.current = true;
    setNotice(null);
    startTransition(async () => {
      let result: ProcurementResult;
      try {
        result = await task(input);
      } catch {
        result = {
          status: "unavailable",
          message:
            "Não foi possível confirmar o resultado. Confirme o envio anterior para evitar duplicidade.",
        };
      }
      setNotice(result);
      setAmbiguous(result.status === "unavailable");
      if (result.status !== "unavailable") attempt.current = null;
      if (result.status === "success") success?.(result);
      locked.current = false;
      requestAnimationFrame(() => noticeRef.current?.focus());
    });
  }
  function retry(success?: Parameters<typeof run>[1]) {
    const previousInput = attempt.current;
    if (previousInput !== null) run(() => previousInput, success);
  }
  return {
    pending,
    notice,
    ambiguous,
    blocked,
    disabled: pending || ambiguous || blocked,
    noticeRef,
    run,
    retry,
  };
}

function MutationNotice({
  notice,
  ambiguous,
  noticeRef,
  reloadHref,
}: {
  notice: ProcurementResult | null;
  ambiguous: boolean;
  noticeRef: RefObject<HTMLDivElement | null>;
  reloadHref: string;
}) {
  return (
    <div
      ref={noticeRef}
      className={notice ? styles.notice : undefined}
      tabIndex={-1}
      role={notice && notice.status !== "success" ? "alert" : "status"}
      aria-live={notice && notice.status !== "success" ? "assertive" : "polite"}
    >
      {notice?.message}
      {ambiguous && (
        <p>
          Os dados estão preservados e bloqueados para edição. Confirme a mesma
          tentativa antes de iniciar outra.
        </p>
      )}
      {notice?.status === "conflict" && (
        <p>
          <a href={reloadHref}>Atualizar e revisar os dados</a>
        </p>
      )}
    </div>
  );
}

function SupplierEditor({
  scope,
  supplier,
  reloadHref,
}: {
  scope: ProcurementScope;
  supplier?: Supplier;
  reloadHref: string;
}) {
  const router = useRouter();
  // This revision belongs to the visible draft. A refresh from another operation
  // must not silently authorize overwriting edits made by another operator.
  const [expectedRevision, setExpectedRevision] = useState(
    supplier?.revision ?? "0",
  );
  const mutation = useMutation<SupplierInput>((input) =>
    saveProcurementSupplier(scope, input),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    mutation.run(
      () => ({
        supplierId: supplier?.id ?? crypto.randomUUID(),
        name: String(data.get("name") ?? ""),
        contact: String(data.get("contact") ?? ""),
        active: data.has("active"),
        expectedRevision,
        idempotencyKey: crypto.randomUUID(),
      }),
      (result) => {
        setExpectedRevision(supplier ? result.revision : "0");
        if (!supplier) form.reset();
        router.refresh();
      },
    );
  }
  return (
    <form
      onSubmit={submit}
      aria-busy={mutation.pending}
      className={styles.stack}
      aria-label={
        supplier ? `Editar fornecedor ${supplier.name}` : "Cadastrar fornecedor"
      }
    >
      <MutationNotice
        notice={mutation.notice}
        ambiguous={mutation.ambiguous}
        noticeRef={mutation.noticeRef}
        reloadHref={reloadHref}
      />
      <fieldset disabled={mutation.disabled}>
        <legend>{supplier ? "Dados do fornecedor" : "Novo fornecedor"}</legend>
        <label className={styles.field}>
          <span>
            {supplier ? `Nome de ${supplier.name}` : "Nome do fornecedor"}
          </span>
          <input
            name="name"
            defaultValue={supplier?.name ?? ""}
            required
            aria-describedby={supplier ? undefined : "supplier-name-help"}
          />
        </label>
        {!supplier && (
          <small id="supplier-name-help">De 3 a 120 caracteres.</small>
        )}
        <label className={styles.field}>
          <span>
            {supplier ? `Contato de ${supplier.name}` : "Contato (opcional)"}
          </span>
          <input name="contact" defaultValue={supplier?.contact ?? ""} />
        </label>
        <label className={styles.check}>
          <input
            name="active"
            type="checkbox"
            defaultChecked={supplier?.active ?? true}
          />
          {supplier
            ? `Fornecedor ativo — ${supplier.name}`
            : "Fornecedor ativo"}
        </label>
      </fieldset>
      <button
        className={styles.primary}
        disabled={mutation.pending || mutation.blocked}
        type="submit"
      >
        {mutation.pending
          ? "Salvando fornecedor…"
          : mutation.ambiguous
            ? "Confirmar envio anterior"
            : supplier
              ? "Salvar fornecedor"
              : "Cadastrar fornecedor"}
      </button>
    </form>
  );
}

type DraftLine = ProcurementVariant & { quantity: string; unitCost: string };
function OrderBuilder({
  scope,
  suppliers,
  reloadHref,
  onCreated,
}: {
  scope: ProcurementScope;
  suppliers: Supplier[];
  reloadHref: string;
  onCreated: (id: string) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [results, setResults] = useState<ProcurementVariant[]>([]);
  const [searchNotice, setSearchNotice] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchPending, startSearch] = useTransition();
  const searchLocked = useRef(false);
  const mutation = useMutation<PurchaseInput>((input) =>
    createPurchaseOrder(scope, input),
  );
  const parsed = lines.map((line) => ({
    quantity: parseInventoryQuantity(line.quantity) ?? 0,
    unitCostCents: parsePurchaseUnitCost(line.unitCost) ?? 0,
  }));
  const total = calculatePurchaseTotal(parsed);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchLocked.current || mutation.disabled) return;
    const query = String(
      new FormData(event.currentTarget).get("variantQuery") ?? "",
    );
    searchLocked.current = true;
    setSearchNotice("");
    startSearch(async () => {
      try {
        const result = await findPurchaseVariants(scope, query);
        if (result.status === "success") {
          setResults(result.items);
          setSearched(true);
        } else {
          setResults([]);
          setSearchNotice(result.message);
        }
      } catch {
        setResults([]);
        setSearchNotice(
          "Não foi possível buscar variantes agora. Tente novamente.",
        );
      }
      searchLocked.current = false;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.run(
      () => ({
        supplierId: String(data.get("supplierId") ?? ""),
        items: lines.map(({ variantId, quantity, unitCost }) => ({
          variantId,
          quantity,
          unitCost,
        })),
        idempotencyKey: crypto.randomUUID(),
      }),
      (result) => {
        setLines([]);
        onCreated(result.id);
      },
    );
  }
  function updateLine(
    id: string,
    field: "quantity" | "unitCost",
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.variantId === id ? { ...line, [field]: value } : line,
      ),
    );
  }
  return (
    <div className={styles.builder}>
      <h2>Novo pedido de compra</h2>
      <p>
        Revise quantidades e custos. Criar o pedido não altera o estoque; o
        recebimento será integral.
      </p>
      <form
        onSubmit={search}
        className={styles.filters}
        role="search"
        aria-label="Buscar variantes para compra"
        aria-busy={searchPending}
      >
        <label className={styles.field}>
          <span>Buscar variante por produto ou SKU</span>
          <input
            name="variantQuery"
            type="search"
            maxLength={200}
            disabled={mutation.disabled || searchPending}
          />
        </label>
        <button
          type="submit"
          className={styles.secondary}
          disabled={mutation.disabled || searchPending}
        >
          {searchPending ? "Buscando SKU…" : "Buscar SKU"}
        </button>
      </form>
      <p role={searchNotice ? "alert" : "status"} aria-live="polite">
        {searchNotice ||
          (searched && !results.length
            ? "Nenhuma variante ativa encontrada. Refine a busca."
            : results.length
              ? "Resultados limitados a 100 variantes ativas. Refine a busca se necessário; suas linhas são preservadas."
              : "")}
      </p>
      {results.length > 0 && (
        <ul className={styles.variantList}>
          {results.map((variant) => (
            <li key={variant.variantId}>
              <div>
                <strong>{variant.productName}</strong>
                <span className={styles.meta}>SKU {variant.sku}</span>
              </div>
              <button
                className={styles.secondary}
                type="button"
                disabled={
                  mutation.disabled ||
                  lines.length >= MAX_PURCHASE_LINES ||
                  lines.some((line) => line.variantId === variant.variantId)
                }
                onClick={() =>
                  setLines((current) =>
                    current.some(
                      (line) => line.variantId === variant.variantId,
                    ) || current.length >= MAX_PURCHASE_LINES
                      ? current
                      : [
                          ...current,
                          { ...variant, quantity: "1", unitCost: "" },
                        ],
                  )
                }
              >
                Adicionar {variant.sku}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={submit}
        className={styles.stack}
        aria-label="Criar pedido de compra"
        aria-busy={mutation.pending}
      >
        <MutationNotice
          notice={mutation.notice}
          ambiguous={mutation.ambiguous}
          noticeRef={mutation.noticeRef}
          reloadHref={reloadHref}
        />
        <fieldset disabled={mutation.disabled}>
          <legend>Itens e fornecedor do pedido</legend>
          <label className={styles.field}>
            <span>Fornecedor do pedido</span>
            <select name="supplierId" defaultValue="" required>
              <option value="" disabled>
                Selecione um fornecedor ativo
              </option>
              {suppliers
                .filter((supplier) => supplier.active)
                .map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </select>
          </label>
          {!suppliers.some((supplier) => supplier.active) && (
            <p>
              Nenhum fornecedor ativo nesta página. Cadastre um fornecedor ou
              consulte outra página da lista.
            </p>
          )}
          <p>
            {lines.length} de {MAX_PURCHASE_LINES} variantes
          </p>
          {!lines.length && <p>Busque um SKU e adicione ao pedido.</p>}
          <ol className={styles.draftLines}>
            {lines.map((line) => (
              <li key={line.variantId}>
                <strong>{line.productName}</strong>
                <span className={styles.meta}>SKU {line.sku}</span>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Quantidade {line.sku}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{1,7}"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(
                          line.variantId,
                          "quantity",
                          event.target.value,
                        )
                      }
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Custo unitário {line.sku}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) =>
                        updateLine(
                          line.variantId,
                          "unitCost",
                          event.target.value,
                        )
                      }
                      placeholder="0,00"
                      required
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() =>
                    setLines((current) =>
                      current.filter(
                        (item) => item.variantId !== line.variantId,
                      ),
                    )
                  }
                >
                  Remover {line.sku}
                </button>
              </li>
            ))}
          </ol>
          <p className={styles.total} aria-live="polite">
            Total para revisão:{" "}
            <strong>
              {total === null
                ? lines.length
                  ? "Revise quantidades, custos e limite do pedido"
                  : formatPurchaseMoney(0)
                : formatPurchaseMoney(total)}
            </strong>
          </p>
          <small>
            Valores em reais, sem separador de milhar. Até R$ 1.000.000,00 por
            unidade e R$ 1.000.000.000,00 por pedido.
          </small>
        </fieldset>
        <button
          className={styles.primary}
          type="submit"
          disabled={mutation.pending || mutation.blocked || !lines.length}
        >
          {mutation.pending
            ? "Criando pedido…"
            : mutation.ambiguous
              ? "Confirmar envio anterior"
              : "Criar pedido"}
        </button>
      </form>
    </div>
  );
}

type OrderAttempt =
  | { operation: "receive"; input: PurchaseTransitionInput }
  | { operation: "cancel"; input: PurchaseCancelInput };
function OrderDetail({
  scope,
  detail,
  permissions,
  reloadHref,
}: {
  scope: ProcurementScope;
  detail: PurchaseDetail;
  permissions: ProcurementPermissions;
  reloadHref: string;
}) {
  const router = useRouter();
  const { order, items } = detail;
  const mutation = useMutation<OrderAttempt>((attempt) =>
    attempt.operation === "receive"
      ? receivePurchaseOrder(scope, attempt.input)
      : cancelPurchaseOrder(scope, attempt.input),
  );
  function receive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.run(
      () => ({
        operation: "receive",
        input: {
          orderId: order.id,
          expectedRevision: order.revision,
          idempotencyKey: crypto.randomUUID(),
        },
      }),
      () => router.refresh(),
    );
  }
  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(
      new FormData(event.currentTarget).get("reason") ?? "",
    );
    mutation.run(
      () => ({
        operation: "cancel",
        input: {
          orderId: order.id,
          expectedRevision: order.revision,
          idempotencyKey: crypto.randomUUID(),
          reason,
        },
      }),
      () => router.refresh(),
    );
  }
  return (
    <>
      <h2>Pedido de {order.supplierName}</h2>
      <p className={styles.meta}>Identificador: {order.id}</p>
      <p className={styles.status}>{statusLabel[order.status]}</p>
      <p className={styles.total}>
        Total: <strong>{formatPurchaseMoney(order.totalCents)}</strong>
      </p>
      <ul className={styles.orderLines}>
        {items.map((item) => (
          <li key={item.variantId}>
            <strong>{item.productName}</strong>
            <span className={styles.meta}>SKU {item.sku}</span>
            <p>
              {item.quantity.toLocaleString("pt-BR")} unidades ×{" "}
              {formatPurchaseMoney(item.unitCostCents)}
            </p>
            <strong>
              {formatPurchaseMoney(item.quantity * item.unitCostCents)}
            </strong>
          </li>
        ))}
      </ul>
      {order.cancellationReason && (
        <p className={styles.notice}>
          Motivo do cancelamento: {order.cancellationReason}
        </p>
      )}
      {order.receivedAt && (
        <p>
          Recebido em{" "}
          <time dateTime={order.receivedAt}>
            {new Date(order.receivedAt).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
          </time>
          . As entradas estão disponíveis no{" "}
          <Link href="/app/estoque">Estoque</Link>.
        </p>
      )}
      <MutationNotice
        notice={mutation.notice}
        ambiguous={mutation.ambiguous}
        noticeRef={mutation.noticeRef}
        reloadHref={reloadHref}
      />
      {order.status === "open" && (
        <div className={styles.stack}>
          {permissions.canReceive && (
            <form
              onSubmit={receive}
              aria-label="Receber pedido"
              aria-busy={mutation.pending}
            >
              <fieldset disabled={mutation.disabled}>
                <legend>Recebimento integral</legend>
                <p>
                  Esta confirmação registra todas as linhas no estoque da loja
                  em uma única operação.
                </p>
                <label className={styles.check}>
                  <input name="confirm" type="checkbox" required />
                  Conferi todas as quantidades do pedido
                </label>
              </fieldset>
              {!mutation.ambiguous && (
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={mutation.pending || mutation.blocked}
                >
                  {mutation.pending
                    ? "Processando pedido…"
                    : "Receber pedido completo"}
                </button>
              )}
            </form>
          )}
          {permissions.canManage && (
            <form
              onSubmit={cancel}
              aria-label="Cancelar pedido"
              aria-busy={mutation.pending}
            >
              <fieldset disabled={mutation.disabled}>
                <legend>Cancelar pedido aberto</legend>
                <label className={styles.field}>
                  <span>Motivo do cancelamento</span>
                  <textarea
                    name="reason"
                    rows={3}
                    required
                    aria-describedby="cancel-reason-help"
                  />
                </label>
                <small id="cancel-reason-help">
                  De 3 a 240 caracteres. O cancelamento não altera o estoque.
                </small>
              </fieldset>
              {!mutation.ambiguous && (
                <button
                  type="submit"
                  className={styles.danger}
                  disabled={mutation.pending || mutation.blocked}
                >
                  {mutation.pending ? "Processando pedido…" : "Cancelar pedido"}
                </button>
              )}
            </form>
          )}
        </div>
      )}
      {mutation.ambiguous && (
        <button
          className={styles.primary}
          disabled={mutation.pending || mutation.blocked}
          onClick={() => mutation.retry(() => router.refresh())}
        >
          Confirmar envio anterior
        </button>
      )}
    </>
  );
}

export function ProcurementWorkspace({
  scope,
  storeName,
  permissions,
  suppliers,
  orders,
  selectedOrder,
  query,
  status,
}: Props) {
  const router = useRouter();
  const [showBuilder, setShowBuilder] = useState(false);
  const orderPages = Math.max(1, Math.ceil(orders.total / orders.pageSize));
  const supplierPages = Math.max(
    1,
    Math.ceil(suppliers.total / suppliers.pageSize),
  );
  const currentHref = hrefFor(
    query,
    status,
    orders.page,
    suppliers.page,
    selectedOrder?.order.id,
  );
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>OPERAÇÕES · {storeName}</p>
          <h1>Compras</h1>
          <p>
            Fornecedores, pedidos e recebimento integral no estoque desta loja.
          </p>
        </div>
        {permissions.canManage && (
          <button
            className={styles.primary}
            onClick={() => setShowBuilder((current) => !current)}
            aria-expanded={showBuilder}
            aria-controls="purchase-builder"
          >
            {showBuilder ? "Fechar novo pedido" : "Novo pedido"}
          </button>
        )}
      </header>
      <form
        method="get"
        action="/app/compras"
        className={styles.filters}
        role="search"
        aria-label="Buscar compras e fornecedores"
      >
        <label className={styles.field}>
          <span>Buscar fornecedor ou pedido</span>
          <input name="q" type="search" maxLength={200} defaultValue={query} />
        </label>
        <label className={styles.field}>
          <span>Estado do pedido</span>
          <select name="estado" defaultValue={status}>
            <option value="all">Todos</option>
            <option value="open">Abertos</option>
            <option value="received">Recebidos</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </label>
        <button className={styles.primary}>Buscar</button>
        {(query || status !== "all") && (
          <Link className={styles.secondary} href="/app/compras">
            Limpar filtros
          </Link>
        )}
      </form>
      {!permissions.canManage && (
        <p className={styles.notice}>
          Você pode consultar compras
          {permissions.canReceive ? " e receber pedidos completos" : ""}.
          Cadastro de fornecedores, criação e cancelamento exigem permissão de
          compras.
        </p>
      )}
      {permissions.canManage && (
        <section
          id="purchase-builder"
          hidden={!showBuilder}
          className={styles.card}
        >
          <OrderBuilder
            scope={scope}
            suppliers={suppliers.items}
            reloadHref={currentHref}
            onCreated={(id) => {
              setShowBuilder(false);
              router.push(hrefFor(query, status, 1, suppliers.page, id));
              router.refresh();
            }}
          />
        </section>
      )}
      <div className={styles.columns}>
        <section className={styles.card} aria-labelledby="orders-heading">
          <div className={styles.sectionHead}>
            <h2 id="orders-heading">Pedidos de compra</h2>
            <span>{orders.total} pedidos</span>
          </div>
          {!orders.items.length ? (
            <p className={styles.empty}>
              Nenhum pedido encontrado
              {query || status !== "all"
                ? " para estes filtros"
                : " nesta loja"}
              .
            </p>
          ) : (
            <ul className={styles.orderList}>
              {orders.items.map((order) => (
                <li key={order.id}>
                  <Link
                    href={hrefFor(
                      query,
                      status,
                      orders.page,
                      suppliers.page,
                      order.id,
                    )}
                    className={
                      selectedOrder?.order.id === order.id
                        ? styles.selectedItem
                        : styles.itemLink
                    }
                    aria-current={
                      selectedOrder?.order.id === order.id ? "true" : undefined
                    }
                  >
                    <strong>{order.supplierName}</strong>
                    <span>{formatPurchaseMoney(order.totalCents)}</span>
                    <span className={styles.meta}>
                      {statusLabel[order.status]} · {order.id.slice(0, 8)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {orderPages > 1 && (
            <nav className={styles.pagination} aria-label="Páginas de pedidos">
              {orders.page > 1 && (
                <Link
                  href={hrefFor(query, status, orders.page - 1, suppliers.page)}
                >
                  Anterior
                </Link>
              )}
              <span>
                Página {orders.page} de {orderPages}
              </span>
              {orders.page < orderPages && (
                <Link
                  href={hrefFor(query, status, orders.page + 1, suppliers.page)}
                >
                  Próxima
                </Link>
              )}
            </nav>
          )}
        </section>
        <section className={styles.card} aria-label="Detalhes do pedido">
          {selectedOrder ? (
            <OrderDetail
              key={`${scope.organizationId}:${scope.storeId}:${selectedOrder.order.id}`}
              scope={scope}
              detail={selectedOrder}
              permissions={permissions}
              reloadHref={currentHref}
            />
          ) : (
            <div className={styles.empty}>
              <h2>Selecione um pedido</h2>
              <p>Consulte os itens, o custo e a situação do recebimento.</p>
            </div>
          )}
        </section>
      </div>
      <section className={styles.card} aria-labelledby="suppliers-heading">
        <div className={styles.sectionHead}>
          <h2 id="suppliers-heading">Fornecedores</h2>
          <span>{suppliers.total} fornecedores</span>
        </div>
        {permissions.canManage && (
          <details className={styles.supplierEditor}>
            <summary>Cadastrar novo fornecedor</summary>
            <SupplierEditor scope={scope} reloadHref={currentHref} />
          </details>
        )}
        {!suppliers.items.length ? (
          <p className={styles.empty}>
            Nenhum fornecedor encontrado.{" "}
            {permissions.canManage
              ? "Cadastre um fornecedor para iniciar as compras."
              : "Consulte outros filtros."}
          </p>
        ) : (
          <ul className={styles.supplierList}>
            {suppliers.items.map((supplier) => (
              <li key={supplier.id}>
                <div className={styles.sectionHead}>
                  <strong>{supplier.name}</strong>
                  <span>{supplier.active ? "Ativo" : "Inativo"}</span>
                </div>
                {supplier.contact && (
                  <p className={styles.meta}>{supplier.contact}</p>
                )}
                {permissions.canManage && (
                  <details className={styles.supplierEditor}>
                    <summary>Editar {supplier.name}</summary>
                    <SupplierEditor
                      scope={scope}
                      supplier={supplier}
                      reloadHref={currentHref}
                    />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {supplierPages > 1 && (
          <nav
            className={styles.pagination}
            aria-label="Páginas de fornecedores"
          >
            {suppliers.page > 1 && (
              <Link
                href={hrefFor(
                  query,
                  status,
                  orders.page,
                  suppliers.page - 1,
                  selectedOrder?.order.id,
                )}
              >
                Fornecedores anteriores
              </Link>
            )}
            <span>
              Página {suppliers.page} de {supplierPages}
            </span>
            {suppliers.page < supplierPages && (
              <Link
                href={hrefFor(
                  query,
                  status,
                  orders.page,
                  suppliers.page + 1,
                  selectedOrder?.order.id,
                )}
              >
                Próximos fornecedores
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
