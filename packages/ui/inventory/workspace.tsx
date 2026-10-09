"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { recordInventoryMovement } from "@/app/actions/inventory";
import type {
  InventoryHistoryPage,
  InventoryItem,
  InventoryMovementInput,
  InventoryMutationResult,
  InventoryScope,
  InventoryStockPage,
} from "@/packages/domain/inventory-contracts";
import styles from "@/app/app/estoque/inventory.module.css";

type Props = {
  scope: InventoryScope;
  storeName: string;
  stock: InventoryStockPage;
  selectedItem: InventoryItem | null;
  history: InventoryHistoryPage | null;
  query: string;
  canWrite: boolean;
};

function hrefFor(query: string, page = 1, variantId = "", historyPage = 1) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("pagina", String(page));
  if (variantId) params.set("variante", variantId);
  if (variantId && historyPage > 1)
    params.set("historico", String(historyPage));
  const suffix = params.toString();
  return "/app/estoque" + (suffix ? "?" + suffix : "");
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function MovementForm({
  scope,
  item,
  reloadHref,
}: {
  scope: InventoryScope;
  item: InventoryItem;
  reloadHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<InventoryMutationResult | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const locked = useRef(false);
  const attempt = useRef<InventoryMovementInput | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const blocked = notice?.status === "conflict" || notice?.status === "denied";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || blocked) return;
    const form = event.currentTarget;
    if (!attempt.current) {
      const data = new FormData(form);
      attempt.current = {
        variantId: item.variantId,
        kind: data.get("kind") === "exit" ? "exit" : "entry",
        quantity: String(data.get("quantity") ?? ""),
        reason: String(data.get("reason") ?? ""),
        expectedRevision: item.revision,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    const input = attempt.current;
    locked.current = true;
    setNotice(null);
    startTransition(async () => {
      let result: InventoryMutationResult;
      try {
        result = await recordInventoryMovement(scope, input);
      } catch {
        result = {
          status: "unavailable",
          message:
            "Não foi possível confirmar o resultado. Repita o envio para consultar a mesma movimentação com segurança.",
        };
      }
      setNotice(result);
      setAmbiguous(result.status === "unavailable");
      if (result.status !== "unavailable") attempt.current = null;
      if (result.status === "success") {
        formRef.current?.reset();
        router.refresh();
      }
      locked.current = false;
      requestAnimationFrame(() => noticeRef.current?.focus());
    });
  }

  return (
    <>
      <div
        ref={noticeRef}
        className={notice ? styles.notice : undefined}
        role={notice && notice.status !== "success" ? "alert" : "status"}
        aria-live={
          notice && notice.status !== "success" ? "assertive" : "polite"
        }
        tabIndex={-1}
      >
        {notice?.message}
        {notice?.status === "conflict" && (
          <p>
            <a href={reloadHref}>Atualizar saldo e revisar movimentação</a>
          </p>
        )}
        {ambiguous && (
          <p>
            Os campos foram preservados. Use “Confirmar envio anterior” antes de
            registrar outra movimentação.
          </p>
        )}
      </div>
      <form
        ref={formRef}
        onSubmit={submit}
        aria-busy={pending}
        className={styles.movementForm}
      >
        <fieldset disabled={pending || ambiguous || blocked}>
          <legend>Nova movimentação</legend>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Tipo de movimentação</span>
              <select name="kind" defaultValue="entry">
                <option value="entry">Entrada</option>
                <option value="exit">Saída</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Quantidade (unidades)</span>
              <input
                name="quantity"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{1,7}"
                required
                aria-describedby="quantity-help"
              />
              <small id="quantity-help">Inteiro de 1 a 1.000.000.</small>
            </label>
          </div>
          <label className={styles.field}>
            <span>Motivo da movimentação</span>
            <textarea
              name="reason"
              required
              rows={3}
              aria-describedby="reason-help"
            />
            <small id="reason-help">
              De 3 a 240 caracteres. O histórico não pode ser editado.
            </small>
          </label>
        </fieldset>
        <button
          className={styles.primary}
          type="submit"
          disabled={pending || blocked}
        >
          {pending
            ? "Registrando movimentação…"
            : ambiguous
              ? "Confirmar envio anterior"
              : "Registrar movimentação"}
        </button>
      </form>
    </>
  );
}

export function InventoryWorkspace({
  scope,
  storeName,
  stock,
  selectedItem,
  history,
  query,
  canWrite,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(stock.total / stock.pageSize));
  const historyPages = history
    ? Math.max(1, Math.ceil(history.total / history.pageSize))
    : 1;
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>OPERAÇÕES · {storeName}</p>
        <h1>Estoque</h1>
        <p>
          Consulte saldos por SKU e registre entradas e saídas justificadas
          nesta loja.
        </p>
      </header>
      <form
        method="get"
        action="/app/estoque"
        className={styles.filters}
        role="search"
      >
        <label className={styles.field}>
          <span>Buscar produto ou SKU</span>
          <input name="q" defaultValue={query} maxLength={200} type="search" />
        </label>
        <button className={styles.primary} type="submit">
          Buscar
        </button>
        {query && (
          <Link className={styles.secondary} href="/app/estoque">
            Limpar busca
          </Link>
        )}
      </form>
      {!canWrite && (
        <p className={styles.notice}>
          Seu acesso permite consultar saldos e histórico. Movimentações exigem
          permissão de estoque.
        </p>
      )}
      <div className={styles.columns}>
        <section className={styles.card} aria-labelledby="stock-heading">
          <div className={styles.sectionHead}>
            <h2 id="stock-heading">Saldos por SKU</h2>
            <span>{formatQuantity(stock.total)} variantes</span>
          </div>
          {stock.items.length === 0 ? (
            <div className={styles.empty}>
              <h3>
                {query
                  ? "Nenhum SKU encontrado"
                  : "Nenhuma variante cadastrada"}
              </h3>
              <p>
                {query
                  ? "Tente outro nome ou SKU."
                  : "Cadastre produtos e variantes no Catálogo para movimentar o estoque."}
              </p>
              {!query && <Link href="/app/produtos">Abrir Catálogo</Link>}
            </div>
          ) : (
            <ul className={styles.stockList}>
              {stock.items.map((item) => (
                <li key={item.variantId}>
                  <Link
                    href={hrefFor(query, stock.page, item.variantId)}
                    aria-current={
                      selectedItem?.variantId === item.variantId
                        ? "true"
                        : undefined
                    }
                    className={
                      selectedItem?.variantId === item.variantId
                        ? styles.selectedItem
                        : styles.itemLink
                    }
                  >
                    <strong>{item.productName}</strong>
                    <span className={styles.meta}>
                      SKU {item.sku}
                      {item.color ? " · " + item.color : ""}
                      {item.size ? " · " + item.size : ""}
                    </span>
                    <span className={styles.balance}>
                      {formatQuantity(item.quantity)} unidades
                    </span>
                    <span
                      className={item.active ? styles.active : styles.inactive}
                    >
                      {item.active ? "Cadastro ativo" : "Cadastro inativo"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <nav aria-label="Páginas de saldos" className={styles.pagination}>
              {stock.page > 1 && (
                <Link href={hrefFor(query, stock.page - 1)}>Anterior</Link>
              )}
              <span>
                Página {stock.page} de {totalPages}
              </span>
              {stock.page < totalPages && (
                <Link href={hrefFor(query, stock.page + 1)}>Próxima</Link>
              )}
            </nav>
          )}
        </section>
        <section className={styles.card} aria-labelledby="detail-heading">
          {!selectedItem ? (
            <div className={styles.empty}>
              <h2 id="detail-heading">Selecione um SKU</h2>
              <p>
                Escolha uma variante para consultar o histórico e movimentar seu
                saldo.
              </p>
            </div>
          ) : (
            <>
              <h2 id="detail-heading">{selectedItem.productName}</h2>
              <p className={styles.meta}>
                SKU {selectedItem.sku}
                {selectedItem.color ? " · " + selectedItem.color : ""}
                {selectedItem.size ? " · " + selectedItem.size : ""}
              </p>
              <p className={styles.currentBalance}>
                Saldo atual:{" "}
                <strong>
                  {formatQuantity(selectedItem.quantity)} unidades
                </strong>
              </p>
              {!selectedItem.active && (
                <p className={styles.notice}>
                  Cadastro inativo. O saldo e o histórico estão preservados;
                  novas movimentações estão indisponíveis.
                </p>
              )}
              {canWrite && selectedItem.active && (
                <MovementForm
                  key={`${scope.organizationId}:${scope.storeId}:${selectedItem.variantId}`}
                  scope={scope}
                  item={selectedItem}
                  reloadHref={hrefFor(
                    query,
                    stock.page,
                    selectedItem.variantId,
                  )}
                />
              )}
              <section
                className={styles.history}
                aria-labelledby="history-heading"
              >
                <h3 id="history-heading">Histórico de movimentações</h3>
                {!history || history.items.length === 0 ? (
                  <p>Nenhuma movimentação registrada para este SKU.</p>
                ) : (
                  <ol className={styles.historyList}>
                    {history.items.map((movement) => (
                      <li key={movement.id}>
                        <div className={styles.sectionHead}>
                          <strong>
                            {movement.kind === "entry" ? "Entrada" : "Saída"} de{" "}
                            {formatQuantity(movement.quantity)} unidades
                          </strong>
                          <time dateTime={movement.createdAt}>
                            {new Date(movement.createdAt).toLocaleString(
                              "pt-BR",
                              { timeZone: "America/Sao_Paulo" },
                            )}
                          </time>
                        </div>
                        <p>{movement.reason}</p>
                        <small>
                          Saldo após movimento:{" "}
                          {formatQuantity(movement.balanceAfter)} unidades
                        </small>
                      </li>
                    ))}
                  </ol>
                )}
                {history && historyPages > 1 && (
                  <nav
                    aria-label="Páginas do histórico"
                    className={styles.pagination}
                  >
                    {history.page > 1 && (
                      <Link
                        href={hrefFor(
                          query,
                          stock.page,
                          selectedItem.variantId,
                          history.page - 1,
                        )}
                      >
                        Histórico anterior
                      </Link>
                    )}
                    <span>
                      Página {history.page} de {historyPages}
                    </span>
                    {history.page < historyPages && (
                      <Link
                        href={hrefFor(
                          query,
                          stock.page,
                          selectedItem.variantId,
                          history.page + 1,
                        )}
                      >
                        Próximo histórico
                      </Link>
                    )}
                  </nav>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
