"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { confirmSale, cancelSale, findSaleVariants } from "@/app/actions/sales";
import type {
  SalesScope,
  SalesPermissions,
  SalesResult,
  SalePage,
  SaleDetail,
  SaleStatus,
  SaleVariant,
} from "@/packages/domain/sales-contracts";
import {
  calculateSaleTotal,
  formatSaleMoney,
  MAX_SALE_LINES,
} from "@/packages/domain/sales";
import { parseInventoryQuantity } from "@/packages/domain/inventory";
import { useHydrated } from "@/packages/ui/use-hydrated";
import {
  saleAttemptKey,
  parseSaleAttempt,
  loadSaleAttempt,
  persistSaleAttempt,
  clearSaleAttempt,
  type SaleAttempt,
} from "./attempt";
import styles from "@/app/app/pdv/sales.module.css";

type Props = {
  scope: SalesScope;
  storeName: string;
  permissions: SalesPermissions;
  sales: SalePage;
  selectedSale: SaleDetail | null;
  query: string;
  status: "all" | SaleStatus;
};
const statusLabel = { confirmed: "Confirmada", cancelled: "Cancelada" };
function hrefFor(
  query = "",
  status: Props["status"] = "all",
  page = 1,
  saleId = "",
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status !== "all") params.set("estado", status);
  if (page > 1) params.set("pagina", String(page));
  if (saleId) params.set("venda", saleId);
  return "/app/pdv" + (params.size ? "?" + params.toString() : "");
}
function useSaleMutation(
  scope: SalesScope,
  userId: string,
  onSuccess: (id: string) => void,
  focusNotice: () => void,
) {
  const hydrated = useHydrated();
  const key = saleAttemptKey(scope, userId);
  const [readyKey, setReadyKey] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<SaleAttempt | null>(null);
  const [notice, setNotice] = useState<SalesResult | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    // Recover the external browser state after mount. Controls remain inert
    // until this scheduled read finishes; cancel it if the identity changes.
    const frame = requestAnimationFrame(() => {
      try {
        const recovered = loadSaleAttempt(sessionStorage, key);
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
  function send(value: SaleAttempt, isRetry = false) {
    if (!ready || locked.current || (!isRetry && attempt !== null)) return;
    try {
      parseSaleAttempt(value);
    } catch {
      setNotice({
        status: "invalid",
        message:
          "Confira os itens e as quantidades. O motivo deve ter de 3 a 240 caracteres, sem contar espaços nas pontas.",
      });
      focusNotice();
      return;
    }
    try {
      persistSaleAttempt(sessionStorage, key, value);
    } catch {
      setStorageError(true);
      return;
    }
    locked.current = true;
    setAttempt(value);
    setNotice(null);
    startTransition(async () => {
      let result: SalesResult;
      try {
        result =
          value.kind === "confirm"
            ? await confirmSale(scope, value.payload)
            : await cancelSale(scope, value.payload);
      } catch {
        result = {
          status: "unavailable",
          message:
            "Não foi possível confirmar o resultado. Confirme o envio anterior com os mesmos dados para evitar duplicidade.",
        };
      }
      const keep =
        result.status === "unavailable" ||
        (result.status === "denied" && uncertain.current);
      if (keep) uncertain.current = true;
      else {
        try {
          clearSaleAttempt(sessionStorage, key);
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
    hydrated,
    ready,
    pending,
    attempt,
    notice,
    storageError,
    disabled: !ready || pending || attempt !== null,
    send,
    retry: () => {
      if (attempt) send(attempt, true);
    },
  };
}
type Mutation = ReturnType<typeof useSaleMutation>;
type DraftLine = SaleVariant & { units: string };
function SaleBuilder({
  scope,
  mutation,
}: {
  scope: SalesScope;
  mutation: Mutation;
}) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [results, setResults] = useState<SaleVariant[]>([]);
  const [searchNotice, setSearchNotice] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchPending, startSearch] = useTransition();
  const searchLocked = useRef(false);
  const total = calculateSaleTotal(
    lines.map((line) => ({
      quantity: parseInventoryQuantity(line.units) ?? 0,
      expectedUnitPriceCents: line.unitPriceCents ?? -1,
    })),
  );
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutation.ready || searchLocked.current) return;
    const query = String(
      new FormData(event.currentTarget).get("variantQuery") ?? "",
    );
    searchLocked.current = true;
    setSearchNotice("");
    startSearch(async () => {
      try {
        const result = await findSaleVariants(scope, query);
        if (result.status === "success") {
          setResults(result.items);
          setSearched(true);
        } else {
          setResults([]);
          setSearchNotice(result.message);
        }
      } catch {
        setSearchNotice("Não foi possível buscar os SKUs. Tente novamente.");
      }
      searchLocked.current = false;
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (total === null || !new FormData(event.currentTarget).has("reviewed"))
      return;
    mutation.send({
      kind: "confirm",
      payload: {
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
    <section className={styles.card} aria-label="Carrinho da venda">
      <h2>Nova venda</h2>
      <p>
        O carrinho não reserva estoque. Revise o preço da loja e as quantidades
        antes de confirmar a baixa integral.
      </p>
      <form
        onSubmit={search}
        role="search"
        aria-label="Buscar SKUs para venda"
        className={styles.filters}
        aria-busy={searchPending}
      >
        <label className={styles.field}>
          <span>Buscar variante por produto, SKU ou código de barras</span>
          <input
            name="variantQuery"
            maxLength={200}
            disabled={!mutation.ready || searchPending}
          />
        </label>
        <button
          className={styles.secondary}
          disabled={!mutation.ready || searchPending}
        >
          {searchPending ? "Buscando…" : "Buscar SKU"}
        </button>
      </form>
      {searchNotice && <p role="alert">{searchNotice}</p>}
      {searched && !results.length && (
        <p role="status">Nenhum SKU ativo encontrado. Refine a busca.</p>
      )}
      {results.length > 0 && (
        <>
          <p className={styles.meta}>
            Até 100 resultados; refine a busca pelo SKU.
          </p>
          <ul className={styles.variantList}>
            {results.map((variant) => (
              <li key={variant.variantId}>
                <div>
                  <strong>{variant.productName}</strong>
                  <span className={styles.meta}>
                    {variant.sku} ·{" "}
                    {variant.unitPriceCents === null
                      ? "Sem preço nesta loja"
                      : formatSaleMoney(variant.unitPriceCents)}{" "}
                    · Saldo consultado: {variant.quantity}
                  </span>
                </div>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={
                    mutation.disabled ||
                    variant.unitPriceCents === null ||
                    lines.length >= MAX_SALE_LINES ||
                    lines.some((line) => line.variantId === variant.variantId)
                  }
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      { ...variant, units: "1" },
                    ])
                  }
                  aria-label={`Adicionar ${variant.sku}`}
                >
                  Adicionar
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        onSubmit={submit}
        aria-label="Confirmar venda"
        aria-busy={mutation.pending}
        className={styles.stack}
      >
        <fieldset disabled={mutation.disabled}>
          <legend>Itens do carrinho</legend>
          {!lines.length && (
            <p className={styles.empty}>Adicione um SKU com preço da loja.</p>
          )}
          <ul className={styles.draftLines}>
            {lines.map((line) => (
              <li key={line.variantId}>
                <strong>
                  {line.productName} · {line.sku}
                </strong>
                <span>
                  Preço unitário: {formatSaleMoney(line.unitPriceCents!)}
                </span>
                <label className={styles.field}>
                  <span>Quantidade {line.sku}</span>
                  <input
                    inputMode="numeric"
                    required
                    pattern="[0-9]+"
                    maxLength={7}
                    value={line.units}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.variantId === line.variantId
                            ? { ...item, units: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
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
          </ul>
          <p className={styles.total}>
            Total revisado:{" "}
            <strong>
              {total === null
                ? "Confira os itens e os limites da venda"
                : formatSaleMoney(total)}
            </strong>
          </p>
          <label className={styles.check}>
            <input type="checkbox" name="reviewed" required />
            Conferi os itens, quantidades e preços desta venda
          </label>
        </fieldset>
        <button
          className={styles.primary}
          disabled={mutation.disabled || total === null}
        >
          Confirmar venda e baixar estoque
        </button>
      </form>
    </section>
  );
}
function SaleDetails({
  detail,
  canCancel,
  mutation,
}: {
  detail: SaleDetail | null;
  canCancel: boolean;
  mutation: Mutation;
}) {
  if (!detail)
    return (
      <section className={styles.card}>
        <h2>Selecione uma venda</h2>
        <p>Consulte os itens e preços registrados na confirmação.</p>
      </section>
    );
  const { sale, items } = detail;
  function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!data.has("returned")) return;
    mutation.send({
      kind: "cancel",
      payload: {
        saleId: sale.id,
        expectedRevision: sale.revision,
        reason: String(data.get("reason") ?? ""),
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }
  return (
    <section className={styles.card} aria-label="Detalhes da venda">
      <h2>Venda {sale.id}</h2>
      <span className={styles.status}>{statusLabel[sale.status]}</span>
      <p>
        Confirmada em{" "}
        {new Date(sale.createdAt).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })}
      </p>
      <ul className={styles.orderLines}>
        {items.map((item) => (
          <li key={item.variantId}>
            <strong>
              {item.productName} · {item.sku}
            </strong>
            <span>
              {item.quantity} unidades × {formatSaleMoney(item.unitPriceCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.total}>
        Total registrado: <strong>{formatSaleMoney(sale.totalCents)}</strong>
      </p>
      {sale.cancelledAt && (
        <p>
          Cancelada em{" "}
          {new Date(sale.cancelledAt).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          })}
        </p>
      )}
      {sale.cancellationReason && (
        <p>Motivo do cancelamento: {sale.cancellationReason}</p>
      )}
      {canCancel && sale.status === "confirmed" && (
        <form
          onSubmit={cancel}
          className={styles.stack}
          aria-label="Cancelar venda"
          aria-busy={mutation.pending}
        >
          <fieldset disabled={mutation.disabled}>
            <legend>Reposição integral das mercadorias</legend>
            <p>
              O cancelamento repõe todos os itens no estoque. Não realiza
              estorno de pagamento.
            </p>
            <label className={styles.field}>
              <span>Motivo do cancelamento</span>
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={480}
                rows={3}
              />
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="returned" required />
              Confirmo que todas as mercadorias retornaram ao estoque
            </label>
          </fieldset>
          <button className={styles.danger} disabled={mutation.disabled}>
            Cancelar venda e repor estoque
          </button>
        </form>
      )}
    </section>
  );
}
export function SalesWorkspace({
  scope,
  storeName,
  permissions,
  sales,
  selectedSale,
  query,
  status,
}: Props) {
  const router = useRouter();
  const [builderRevision, setBuilderRevision] = useState(0);
  const noticeRef = useRef<HTMLDivElement>(null);
  const mutation = useSaleMutation(
    scope,
    permissions.userId,
    (id) => {
      setBuilderRevision((v) => v + 1);
      router.push(hrefFor(query, status, sales.page, id));
      router.refresh();
    },
    () => requestAnimationFrame(() => noticeRef.current?.focus()),
  );
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>OPERAÇÕES · {storeName}</p>
          <h1>PDV / Vendas</h1>
          <p>Venda básica com preço da loja, baixa de estoque e histórico.</p>
        </div>
      </header>
      <noscript>
        Ative o JavaScript para confirmar ou cancelar vendas com segurança.
      </noscript>
      <div
        ref={noticeRef}
        tabIndex={-1}
        className={
          mutation.notice || mutation.attempt || mutation.storageError
            ? styles.notice
            : undefined
        }
        role={mutation.notice?.status === "success" ? "status" : "alert"}
        aria-live={
          mutation.notice?.status === "success" ? "polite" : "assertive"
        }
      >
        {mutation.storageError && (
          <p>
            O armazenamento seguro desta aba está indisponível ou contém uma
            tentativa inválida. Nenhuma nova operação será enviada. Recupere o
            armazenamento e recarregue a página para conferir a tentativa
            anterior.
          </p>
        )}
        {mutation.notice && <p>{mutation.notice.message}</p>}
        {mutation.notice?.status === "conflict" && (
          <a href={hrefFor(query, status, sales.page, selectedSale?.sale.id)}>
            Atualizar e revisar os dados
          </a>
        )}
        {mutation.attempt && (
          <>
            <h2>Envio anterior pendente de confirmação</h2>
            <p>
              Os dados e a chave estão preservados nesta aba, por usuário e
              loja. Confirme a mesma tentativa antes de iniciar outra.
            </p>
            {mutation.attempt.kind === "confirm" ? (
              <ul>
                {mutation.attempt.payload.items.map((line) => (
                  <li key={line.variantId}>
                    {line.variantId}: {line.quantity} unidades ×{" "}
                    {formatSaleMoney(line.expectedUnitPriceCents)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Cancelamento da venda {mutation.attempt.payload.saleId}:{" "}
                {mutation.attempt.payload.reason}
              </p>
            )}
            <button
              type="button"
              className={styles.primary}
              disabled={!mutation.ready || mutation.pending}
              onClick={mutation.retry}
            >
              {mutation.pending
                ? "Confirmando envio…"
                : "Confirmar envio anterior"}
            </button>
          </>
        )}
      </div>
      {permissions.canConfirm && (
        <SaleBuilder key={builderRevision} scope={scope} mutation={mutation} />
      )}
      <form
        method="get"
        className={styles.filters}
        role="search"
        aria-label="Buscar vendas"
      >
        <label className={styles.field}>
          <span>Buscar venda por número, produto ou SKU</span>
          <input name="q" defaultValue={query} maxLength={200} />
        </label>
        <label className={styles.field}>
          <span>Estado da venda</span>
          <select name="estado" defaultValue={status}>
            <option value="all">Todos</option>
            <option value="confirmed">Confirmadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <button className={styles.secondary}>Buscar vendas</button>
      </form>
      <div className={styles.columns}>
        <section className={styles.card}>
          <div className={styles.sectionHead}>
            <h2>Vendas da loja</h2>
            <span>{sales.total} vendas</span>
          </div>
          {!sales.items.length ? (
            <p className={styles.empty}>Nenhuma venda encontrada.</p>
          ) : (
            <ul className={styles.orderList}>
              {sales.items.map((sale) => (
                <li key={sale.id}>
                  <Link
                    className={
                      sale.id === selectedSale?.sale.id
                        ? styles.selectedItem
                        : styles.itemLink
                    }
                    aria-current={
                      sale.id === selectedSale?.sale.id ? "page" : undefined
                    }
                    href={hrefFor(query, status, sales.page, sale.id)}
                  >
                    <strong>Venda {sale.id}</strong>
                    <span>
                      {statusLabel[sale.status]} ·{" "}
                      {formatSaleMoney(sale.totalCents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pagination} aria-label="Paginação de vendas">
            {sales.page > 1 && (
              <Link href={hrefFor(query, status, sales.page - 1)}>
                Página anterior
              </Link>
            )}
            <span>Página {sales.page}</span>
            {sales.page * sales.pageSize < sales.total && (
              <Link href={hrefFor(query, status, sales.page + 1)}>
                Próxima página
              </Link>
            )}
          </nav>
        </section>
        <SaleDetails
          key={selectedSale?.sale.id ?? "empty"}
          detail={selectedSale}
          canCancel={permissions.canCancel}
          mutation={mutation}
        />
      </div>
    </div>
  );
}
