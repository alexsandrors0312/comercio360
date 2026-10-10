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
import { saveCustomer, searchCustomerDirectory } from "@/app/actions/customers";
import type {
  Customer,
  CustomerPage,
  CustomerPermissions,
  CustomerSalePage,
  CustomerScope,
  CustomerSaveResult,
  SaveCustomerInput,
} from "@/packages/domain/customers-contracts";
import { useHydrated } from "@/packages/ui/use-hydrated";
import {
  clearCustomerAttempt,
  customerAttemptKey,
  loadCustomerAttempt,
  parseCustomerAttempt,
  persistCustomerAttempt,
  type CustomerAttempt,
} from "./attempt";
import styles from "@/app/app/clientes/customers.module.css";

type Props = {
  scope: CustomerScope;
  storeName: string;
  permissions: CustomerPermissions;
  customers: CustomerPage;
  selectedCustomer: Customer | null;
  customerSales: CustomerSalePage | null;
};

function hrefFor(
  customerId = "",
  salesPage = 1,
) {
  const params = new URLSearchParams();
  if (customerId) params.set("cliente", customerId);
  if (salesPage > 1) params.set("vendasPagina", String(salesPage));
  return "/app/clientes" + (params.size ? "?" + params.toString() : "");
}

function useCustomerMutation(
  scope: CustomerScope,
  userId: string,
  onSuccess: (id: string) => void,
  focusNotice: () => void,
) {
  const hydrated = useHydrated();
  const key = customerAttemptKey(scope, userId);
  const [readyKey, setReadyKey] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [attempt, setAttempt] = useState<CustomerAttempt | null>(null);
  const [notice, setNotice] = useState<CustomerSaveResult | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const recovered = loadCustomerAttempt(sessionStorage, key);
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
  function send(value: CustomerAttempt, retry = false) {
    if (!ready || locked.current || (!retry && attempt !== null)) return;
    try {
      parseCustomerAttempt(value);
    } catch {
      setNotice({
        status: "invalid",
        message: "Confira os dados do cliente e tente novamente.",
      });
      focusNotice();
      return;
    }
    try {
      persistCustomerAttempt(sessionStorage, key, value);
    } catch {
      setStorageError(true);
      return;
    }
    locked.current = true;
    setAttempt(value);
    setNotice(null);
    startTransition(async () => {
      let result: CustomerSaveResult;
      try {
        result = await saveCustomer(scope, value.payload);
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
          clearCustomerAttempt(sessionStorage, key);
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
type Mutation = ReturnType<typeof useCustomerMutation>;

function CustomerEditor({
  customer,
  mutation,
}: {
  customer?: Customer;
  mutation: Mutation;
}) {
  function input(data: FormData, active: boolean): SaveCustomerInput {
    return {
      customerId: customer?.id ?? null,
      expectedRevision: customer?.revision ?? null,
      name: String(data.get("name") ?? ""),
      phone: String(data.get("phone") ?? "").trim() || null,
      email: String(data.get("email") ?? "").trim() || null,
      active,
      idempotencyKey: crypto.randomUUID(),
    };
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.send({
      kind: "save",
      payload: input(data, customer?.active ?? true),
    });
  }
  function changeStatus() {
    if (!customer) return;
    mutation.send({
      kind: "save",
      payload: {
        customerId: customer.id,
        expectedRevision: customer.revision,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        active: !customer.active,
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }
  return (
    <section
      className={styles.card}
      aria-label={customer ? "Editar cliente" : "Cadastrar cliente"}
    >
      <h2>{customer ? "Editar cadastro" : "Novo cliente"}</h2>
      <p className={styles.meta}>
        Nome obrigatório. Telefone e e-mail opcionais.
      </p>
      <form
        onSubmit={submit}
        className={styles.stack}
        aria-busy={mutation.pending}
      >
        <fieldset disabled={mutation.disabled}>
          <legend>
            {customer ? "Dados do cliente" : "Cadastro de cliente"}
          </legend>
          <label className={styles.field}>
            <span>Nome do cliente</span>
            <input
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={120}
              required
              defaultValue={customer?.name ?? ""}
            />
          </label>
          <label className={styles.field}>
            <span>Telefone (opcional)</span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={64}
              defaultValue={customer?.phone ?? ""}
            />
          </label>
          <label className={styles.field}>
            <span>E-mail (opcional)</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              defaultValue={customer?.email ?? ""}
            />
          </label>
        </fieldset>
        <button className={styles.primary} disabled={mutation.disabled}>
          {customer ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
      </form>
      {customer && (
        <button
          type="button"
          className={customer.active ? styles.danger : styles.secondary}
          disabled={mutation.disabled}
          onClick={changeStatus}
        >
          {customer.active ? "Inativar cliente" : "Reativar cliente"}
        </button>
      )}
    </section>
  );
}

export function CustomersWorkspace({
  scope,
  storeName,
  permissions,
  customers,
  selectedCustomer,
  customerSales,
}: Props) {
  const router = useRouter();
  const noticeRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const [directory, setDirectory] = useState(customers);
  const [queryInput, setQueryInput] = useState("");
  const [statusInput, setStatusInput] = useState<"all" | "active" | "inactive">("all");
  const [criteria, setCriteria] = useState({ query: "", status: "all" as "all" | "active" | "inactive" });
  const [searchNotice, setSearchNotice] = useState("");
  const [searchPending, startSearch] = useTransition();
  const searchSequence = useRef(0);
  function search(query: string, status: "all" | "active" | "inactive", page: number) {
    const sequence = ++searchSequence.current;
    setSearchNotice("");
    startSearch(async () => {
      try {
        const result = await searchCustomerDirectory(scope, { query, status, page });
        if (sequence !== searchSequence.current) return;
        if (result.status === "success") {
          setDirectory(result.page);
          setCriteria({ query, status });
        } else setSearchNotice(result.message);
      } catch {
        if (sequence === searchSequence.current)
          setSearchNotice("Não foi possível buscar clientes desta empresa.");
      }
    });
  }
  const mutation = useCustomerMutation(
    scope,
    permissions.userId,
    (id) => {
      router.push(hrefFor(id));
      router.refresh();
    },
    () => requestAnimationFrame(() => noticeRef.current?.focus()),
  );
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>CADASTRO · {storeName}</p>
        <h1>Clientes</h1>
        <p>
          Cadastro compartilhado na empresa. O histórico mostra apenas vendas
          desta loja.
        </p>
      </header>
      <noscript>
        Ative o JavaScript para cadastrar ou alterar clientes com segurança.
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
            O armazenamento desta aba está indisponível ou contém uma tentativa
            inválida. Nenhuma nova alteração será enviada. Recupere o
            armazenamento e recarregue a página para conferir a tentativa
            anterior.
          </p>
        )}
        {mutation.notice && <p>{mutation.notice.message}</p>}
        {mutation.notice?.status === "conflict" && (
          <a href={hrefFor(selectedCustomer?.id)}>
            Atualizar e revisar o cadastro
          </a>
        )}
        {mutation.attempt && (
          <>
            <h2>Envio anterior pendente de confirmação</h2>
            <p>
              Os dados e a chave desta tentativa foram preservados nesta aba.
              Confirme o mesmo envio antes de iniciar outra alteração.
            </p>
            <p>Cadastro: {mutation.attempt.payload.name}</p>
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (hydrated && !searchPending) search(queryInput, statusInput, 1);
        }}
        role="search"
        aria-label="Buscar clientes"
        className={styles.filters}
        aria-busy={searchPending}
      >
        <label className={styles.field}>
          <span>Buscar por nome, telefone ou e-mail</span>
          <input
            name="q"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            maxLength={200}
            disabled={!hydrated || searchPending}
          />
        </label>
        <label className={styles.field}>
          <span>Estado do cliente</span>
          <select
            name="estado"
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value as typeof statusInput)}
            disabled={!hydrated || searchPending}
          >
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </label>
        <button className={styles.secondary} disabled={!hydrated || searchPending}>
          Buscar clientes
        </button>
      </form>
      {searchNotice && <p role="alert" className={styles.notice}>{searchNotice}</p>}
      {permissions.canCreate && (
        <CustomerEditor key="new" mutation={mutation} />
      )}
      <div className={styles.columns}>
        <section className={styles.card} aria-label="Lista de clientes">
          <div className={styles.sectionHead}>
            <h2>Clientes da empresa</h2>
            <span>{directory.total} clientes</span>
          </div>
          {!directory.items.length ? (
            <p className={styles.empty}>Nenhum cliente encontrado.</p>
          ) : (
            <ul className={styles.customerList}>
              {directory.items.map((customer) => (
                <li key={customer.id}>
                  <Link
                    className={
                      customer.id === selectedCustomer?.id
                        ? styles.selectedItem
                        : styles.itemLink
                    }
                    aria-current={
                      customer.id === selectedCustomer?.id ? "page" : undefined
                    }
                    href={hrefFor(customer.id)}
                  >
                    <strong>{customer.name}</strong>
                    <span>{customer.active ? "Ativo" : "Inativo"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pagination} aria-label="Paginação de clientes">
            {directory.page > 1 && (
              <button type="button" disabled={!hydrated || searchPending} onClick={() => search(criteria.query, criteria.status, directory.page - 1)}>
                Página anterior
              </button>
            )}
            <span>Página {directory.page}</span>
            {directory.page * directory.pageSize < directory.total && (
              <button type="button" disabled={!hydrated || searchPending} onClick={() => search(criteria.query, criteria.status, directory.page + 1)}>
                Próxima página
              </button>
            )}
          </nav>
        </section>
        <div className={styles.detailColumn}>
          {!selectedCustomer ? (
            <section className={styles.card}>
              <h2>Selecione um cliente</h2>
              <p>Consulte os contatos e as vendas da loja selecionada.</p>
            </section>
          ) : (
            <>
              <section className={styles.card} aria-label="Detalhes do cliente">
                <h2>{selectedCustomer.name}</h2>
                <p>
                  {selectedCustomer.active ? "Ativo" : "Inativo"} · Revisão{" "}
                  {selectedCustomer.revision}
                </p>
                <dl className={styles.details}>
                  <dt>Telefone</dt>
                  <dd>{selectedCustomer.phone ?? "Não informado"}</dd>
                  <dt>E-mail</dt>
                  <dd>{selectedCustomer.email ?? "Não informado"}</dd>
                </dl>
              </section>
              {permissions.canEdit && (
                <CustomerEditor
                  key={selectedCustomer.id + ":" + selectedCustomer.revision}
                  customer={selectedCustomer}
                  mutation={mutation}
                />
              )}
              <section
                className={styles.card}
                aria-label="Vendas do cliente nesta loja"
              >
                <h2>Vendas nesta loja</h2>
                {!customerSales?.items.length ? (
                  <p className={styles.empty}>
                    Nenhuma venda deste cliente nesta loja.
                  </p>
                ) : (
                  <ul className={styles.customerList}>
                    {customerSales.items.map((sale) => (
                      <li key={sale.id}>
                        <Link
                          className={styles.itemLink}
                          href={`/app/pdv?venda=${encodeURIComponent(sale.id)}`}
                        >
                          <strong>Venda {sale.id}</strong>
                          <span>
                            {sale.status === "cancelled"
                              ? "Cancelada"
                              : "Confirmada"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {customerSales && (
                  <nav
                    className={styles.pagination}
                    aria-label="Paginação de vendas do cliente"
                  >
                    {customerSales.page > 1 && (
                      <Link
                        href={hrefFor(selectedCustomer.id, customerSales.page - 1)}
                      >
                        Página anterior
                      </Link>
                    )}
                    <span>Página {customerSales.page}</span>
                    {customerSales.page * customerSales.pageSize <
                      customerSales.total && (
                      <Link
                        href={hrefFor(selectedCustomer.id, customerSales.page + 1)}
                      >
                        Próxima página
                      </Link>
                    )}
                  </nav>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
