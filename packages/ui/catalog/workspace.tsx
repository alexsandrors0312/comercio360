"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import {
  createCatalogCategory,
  createCatalogProduct,
  createCatalogVariant,
  setCatalogPrice,
  updateCatalogCategory,
  updateCatalogProduct,
  updateCatalogVariant,
  type CatalogMutationResult,
} from "@/app/actions/catalog";
import { formatBrlPrice } from "@/packages/domain/catalog";
import type {
  CatalogCategory,
  CatalogPage,
  CatalogProduct,
  CatalogScope,
  CatalogVariant,
} from "@/lib/catalog/server";
import { CatalogCover } from "@/packages/ui/catalog/cover";
import styles from "@/app/app/produtos/catalog.module.css";

type Filters = {
  query: string;
  categoryId: string | null;
  status: "all" | "active" | "inactive";
};

type Props = {
  scope: CatalogScope;
  storeName: string;
  categories: CatalogCategory[];
  products: CatalogPage;
  product: CatalogProduct | null;
  selectedId: string;
  filters: Filters;
  canWrite: boolean;
};

function hrefFor(filters: Filters, page = 1, productId = ""): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.categoryId) params.set("categoria", filters.categoryId);
  if (filters.status !== "active") params.set("estado", filters.status);
  if (page > 1) params.set("pagina", String(page));
  if (productId) params.set("produto", productId);
  const query = params.toString();
  return "/app/produtos" + (query ? "?" + query : "");
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}
function optional(form: FormData, name: string): string | null {
  return value(form, name).trim() || null;
}
function Field({
  label,
  name,
  defaultValue,
  required,
  maxLength,
  type = "text",
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  maxLength?: number;
  type?: string;
  hint?: string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        maxLength={maxLength}
        aria-describedby={hint ? name + "-hint" : undefined}
      />
      {hint && <small id={name + "-hint"}>{hint}</small>}
    </label>
  );
}

function VariantFields({ variant }: { variant?: CatalogVariant }) {
  return (
    <div className={styles.fieldGrid}>
      <Field
        label="SKU"
        name="sku"
        defaultValue={variant?.sku}
        required
        maxLength={64}
      />
      <Field
        label="Cor (opcional)"
        name="color"
        defaultValue={variant?.color}
        maxLength={60}
      />
      <Field
        label="Tamanho (opcional)"
        name="size"
        defaultValue={variant?.size}
        maxLength={60}
      />
      <Field
        label="Código de barras (opcional)"
        name="barcode"
        defaultValue={variant?.barcode}
        maxLength={64}
      />
    </div>
  );
}

export function CatalogWorkspace({
  scope,
  storeName,
  categories,
  products,
  product,
  selectedId,
  filters,
  canWrite,
}: Props) {
  const router = useRouter();
  const [panel, setPanel] = useState<"list" | "new" | "categories">("list");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<CatalogMutationResult | null>(null);
  const [confirmProduct, setConfirmProduct] = useState(false);
  const [confirmVariant, setConfirmVariant] = useState<string | null>(null);
  const newAttempt = useRef<{ key: string; payload: string } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const firstFormRef = useRef<HTMLInputElement>(null);
  const [editingProduct, setEditingProduct] = useState(false);

  async function perform(
    label: string,
    task: () => Promise<CatalogMutationResult>,
    onSuccess?: (
      result: Extract<CatalogMutationResult, { status: "success" }>,
    ) => void,
  ) {
    if (busy) return;
    setBusy(label);
    setNotice(null);
    let result: CatalogMutationResult;
    try {
      result = await task();
    } catch {
      result = {
        status: "unavailable",
        message: "Não foi possível salvar agora. Tente novamente.",
      };
    }
    setBusy(null);
    setNotice(result);
    if (result.status === "success") {
      onSuccess?.(result);
      router.refresh();
    }
    requestAnimationFrame(() => noticeRef.current?.focus());
  }

  function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void perform(
      "category",
      () => createCatalogCategory(scope, { name: value(data, "name") }),
      () => form.reset(),
    );
  }

  function submitCategoryEdit(
    event: FormEvent<HTMLFormElement>,
    category: CatalogCategory,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform("category-" + category.id, () =>
      updateCatalogCategory(scope, category.id, {
        name: value(data, "name"),
        active: data.has("active"),
        expectedRevision: category.revision,
      }),
    );
  }

  function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      name: value(data, "name"),
      description: optional(data, "description"),
      categoryId: optional(data, "categoryId"),
      initialVariant: {
        sku: value(data, "sku"),
        color: optional(data, "color"),
        size: optional(data, "size"),
        barcode: optional(data, "barcode"),
        unit: "UN" as const,
      },
    };
    const payload = JSON.stringify(input);
    if (newAttempt.current?.payload !== payload)
      newAttempt.current = { key: crypto.randomUUID(), payload };
    void perform(
      "product-new",
      () =>
        createCatalogProduct(scope, {
          ...input,
          idempotencyKey: newAttempt.current!.key,
        }),
      (result) => {
        newAttempt.current = null;
        setPanel("list");
        router.push(hrefFor(filters, 1, result.id));
      },
    );
  }

  function submitProductEdit(
    event: FormEvent<HTMLFormElement>,
    item: CatalogProduct,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform(
      "product-edit",
      () =>
        updateCatalogProduct(scope, item.id, {
          name: value(data, "name"),
          description: optional(data, "description"),
          categoryId: optional(data, "categoryId"),
          active: item.active,
          expectedRevision: item.revision,
        }),
      () => setEditingProduct(false),
    );
  }

  function toggleProduct(item: CatalogProduct) {
    void perform(
      "product-status",
      () =>
        updateCatalogProduct(scope, item.id, {
          name: item.name,
          description: item.description,
          categoryId: item.categoryId,
          active: !item.active,
          expectedRevision: item.revision,
        }),
      () => setConfirmProduct(false),
    );
  }

  function submitVariant(
    event: FormEvent<HTMLFormElement>,
    item: CatalogProduct,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void perform(
      "variant-new",
      () =>
        createCatalogVariant(scope, item.id, {
          sku: value(data, "sku"),
          color: optional(data, "color"),
          size: optional(data, "size"),
          barcode: optional(data, "barcode"),
          unit: "UN",
        }),
      () => form.reset(),
    );
  }

  function submitVariantEdit(
    event: FormEvent<HTMLFormElement>,
    variant: CatalogVariant,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform("variant-" + variant.id, () =>
      updateCatalogVariant(scope, variant.id, {
        sku: value(data, "sku"),
        color: optional(data, "color"),
        size: optional(data, "size"),
        barcode: optional(data, "barcode"),
        unit: "UN",
        active: variant.active,
        expectedRevision: variant.revision,
      }),
    );
  }

  function toggleVariant(variant: CatalogVariant) {
    void perform(
      "variant-status-" + variant.id,
      () =>
        updateCatalogVariant(scope, variant.id, {
          sku: variant.sku,
          color: variant.color,
          size: variant.size,
          barcode: variant.barcode,
          unit: "UN",
          active: !variant.active,
          expectedRevision: variant.revision,
        }),
      () => setConfirmVariant(null),
    );
  }

  function submitPrice(
    event: FormEvent<HTMLFormElement>,
    variant: CatalogVariant,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void perform("price-" + variant.id, () =>
      setCatalogPrice(scope, variant.id, {
        value: value(data, "price"),
        expectedRevision: variant.price?.revision ?? null,
      }),
    );
  }

  function openPanel(next: "list" | "new" | "categories") {
    setPanel(next);
    setNotice(null);
    if (next === "new")
      requestAnimationFrame(() => firstFormRef.current?.focus());
  }

  const categoryName = (id: string | null) =>
    categories.find((category) => category.id === id)?.name ?? "Sem categoria";
  const totalPages = Math.max(1, Math.ceil(products.total / products.pageSize));
  const hasFilter = Boolean(
    filters.query || filters.categoryId || filters.status !== "active",
  );

  return (
    <section className={styles.catalog} aria-labelledby="catalog-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CATÁLOGO DA EMPRESA</p>
          <h1 id="catalog-title">Produtos</h1>
          <p>
            Produtos e variantes são comuns à empresa. Os preços exibidos são da
            loja {storeName}.
          </p>
        </div>
        {canWrite && (
          <div className={styles.headingActions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => openPanel("categories")}
              aria-pressed={panel === "categories"}
            >
              Categorias
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => openPanel("new")}
              aria-pressed={panel === "new"}
            >
              Novo produto
            </button>
          </div>
        )}
      </div>
      <div
        ref={noticeRef}
        tabIndex={-1}
        className={
          notice
            ? notice.status === "success"
              ? styles.success
              : styles.errorNotice
            : styles.noticeSlot
        }
        role={notice && notice.status !== "success" ? "alert" : "status"}
        aria-live="polite"
      >
        {notice && (
          <>
            <span>{notice.message}</span>
            {notice.status === "conflict" && (
              <button type="button" onClick={() => window.location.reload()}>
                Recarregar dados
              </button>
            )}
          </>
        )}
      </div>

      {panel === "categories" && canWrite ? (
        <section className={styles.card} aria-labelledby="categories-title">
          <div className={styles.sectionHead}>
            <h2 id="categories-title">Categorias</h2>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => openPanel("list")}
            >
              Voltar aos produtos
            </button>
          </div>
          <p className={styles.help}>
            Categorias inativas permanecem nos produtos já cadastrados.
          </p>
          <form onSubmit={submitCategory} className={styles.inlineForm}>
            <Field
              label="Nova categoria"
              name="name"
              required
              maxLength={120}
            />
            <button className={styles.primary} disabled={busy !== null}>
              {busy === "category" ? "Salvando…" : "Adicionar"}
            </button>
          </form>
          {categories.length === 0 ? (
            <p className={styles.empty}>Nenhuma categoria cadastrada.</p>
          ) : (
            <ul className={styles.categoryList}>
              {categories.map((category) => (
                <li key={category.id + "-" + category.revision}>
                  <details>
                    <summary>
                      {category.name}{" "}
                      <span>{category.active ? "Ativa" : "Inativa"}</span>
                    </summary>
                    <form
                      onSubmit={(event) => submitCategoryEdit(event, category)}
                      className={styles.inlineForm}
                    >
                      <Field
                        label="Nome da categoria"
                        name="name"
                        defaultValue={category.name}
                        required
                        maxLength={120}
                      />
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={category.active}
                        />{" "}
                        Categoria ativa
                      </label>
                      <button
                        className={styles.secondary}
                        disabled={busy !== null}
                      >
                        {busy === "category-" + category.id
                          ? "Salvando…"
                          : "Salvar categoria"}
                      </button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : panel === "new" && canWrite ? (
        <section className={styles.card} aria-labelledby="new-title">
          <div className={styles.sectionHead}>
            <h2 id="new-title">Novo produto</h2>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => openPanel("list")}
            >
              Cancelar
            </button>
          </div>
          <p className={styles.help}>
            Cadastre o produto com a primeira variante. O preço pode ser
            informado após salvar.
          </p>
          <form onSubmit={submitProduct} className={styles.stack}>
            <label className={styles.field}>
              <span>Nome do produto</span>
              <input ref={firstFormRef} name="name" required maxLength={120} />
            </label>
            <label className={styles.field}>
              <span>Descrição (opcional)</span>
              <textarea name="description" maxLength={2000} rows={3} />
            </label>
            <label className={styles.field}>
              <span>Categoria (opcional)</span>
              <select name="categoryId" defaultValue="">
                <option value="">Sem categoria</option>
                {categories
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </label>
            <h3>Primeira variante</h3>
            <VariantFields />
            <p className={styles.help}>
              Sem cor e tamanho, a variante representa o produto único. Unidade:
              UN.
            </p>
            <button className={styles.primary} disabled={busy !== null}>
              {busy === "product-new" ? "Salvando…" : "Criar produto"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className={styles.card} aria-labelledby="search-title">
            <h2 id="search-title" className={styles.srOnly}>
              Pesquisar produtos
            </h2>
            <form
              action="/app/produtos"
              method="get"
              className={styles.filters}
              role="search"
            >
              <label className={styles.field}>
                <span>Buscar por nome, SKU ou código de barras</span>
                <input
                  name="q"
                  type="search"
                  defaultValue={filters.query}
                  maxLength={200}
                  placeholder="Busque no catálogo"
                />
              </label>
              <label className={styles.field}>
                <span>Categoria</span>
                <select
                  name="categoria"
                  defaultValue={filters.categoryId ?? ""}
                >
                  <option value="">Todas</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {category.active ? "" : " (inativa)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Situação</span>
                <select name="estado" defaultValue={filters.status}>
                  <option value="active">Ativos</option>
                  <option value="inactive">Inativos</option>
                  <option value="all">Todos</option>
                </select>
              </label>
              <button className={styles.primary}>Buscar</button>
              {hasFilter && (
                <Link className={styles.linkButton} href="/app/produtos">
                  Limpar filtros
                </Link>
              )}
            </form>
          </section>
          <div className={styles.columns}>
            <section className={styles.card} aria-labelledby="results-title">
              <div className={styles.sectionHead}>
                <h2 id="results-title">Resultados</h2>
                <span className={styles.count}>
                  {products.total}{" "}
                  {products.total === 1 ? "produto" : "produtos"}
                </span>
              </div>
              {products.items.length === 0 ? (
                <div className={styles.empty}>
                  <h3>
                    {hasFilter
                      ? "Nenhum produto encontrado"
                      : "Seu catálogo está vazio"}
                  </h3>
                  <p>
                    {hasFilter
                      ? "Tente outros termos ou filtros."
                      : "Os produtos cadastrados aparecerão aqui."}
                  </p>
                </div>
              ) : (
                <ul className={styles.productList}>
                  {products.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={hrefFor(filters, products.page, item.id)}
                        className={
                          selectedId === item.id
                            ? styles.selectedProduct
                            : styles.productLink
                        }
                        aria-current={
                          selectedId === item.id ? "true" : undefined
                        }
                      >
                        <span className={styles.productTitle}>{item.name}</span>
                        <span className={styles.meta}>
                          {categoryName(item.categoryId)} ·{" "}
                          {item.active ? "Ativo" : "Inativo"}
                        </span>
                        <span className={styles.price}>
                          {item.priceFrom === null
                            ? "Sem preço"
                            : "A partir de " + formatBrlPrice(item.priceFrom)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {products.total > products.pageSize && (
                <nav
                  className={styles.pagination}
                  aria-label="Páginas de produtos"
                >
                  {products.page > 1 ? (
                    <Link href={hrefFor(filters, products.page - 1)}>
                      Anterior
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    Página {products.page} de {totalPages}
                  </span>
                  {products.page < totalPages ? (
                    <Link href={hrefFor(filters, products.page + 1)}>
                      Próxima
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </section>

            <section className={styles.card} aria-labelledby="detail-title">
              {!selectedId ? (
                <div className={styles.empty}>
                  <h2 id="detail-title">Detalhes</h2>
                  <p>
                    Selecione um produto da lista para ver variantes e preços da
                    loja {storeName}.
                  </p>
                </div>
              ) : !product ? (
                <div className={styles.empty} role="status">
                  <h2 id="detail-title">Produto não encontrado</h2>
                  <p>Este produto não está disponível no catálogo atual.</p>
                  <Link href={hrefFor(filters, products.page)}>
                    Voltar à lista
                  </Link>
                </div>
              ) : (
                <>
                  <div className={styles.sectionHead}>
                    <div>
                      <p className={styles.eyebrow}>DETALHE DO PRODUTO</p>
                      <h2 id="detail-title">{product.name}</h2>
                    </div>
                    <span
                      className={
                        product.active ? styles.active : styles.inactive
                      }
                    >
                      {product.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <p className={styles.detailDescription}>
                    {product.description || "Sem descrição."}
                  </p>
                  <dl className={styles.details}>
                    <div>
                      <dt>Categoria</dt>
                      <dd>{categoryName(product.categoryId)}</dd>
                    </div>
                  </dl>
                  <CatalogCover
                    key={product.id + "-" + product.revision}
                    scope={scope}
                    productId={product.id}
                    productName={product.name}
                    revision={product.revision}
                    hasCover={product.hasCover}
                    canWrite={canWrite}
                    active={product.active}
                  />
                  {canWrite && (
                    <div className={styles.editor}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={() => setEditingProduct(!editingProduct)}
                          aria-expanded={editingProduct}
                        >
                          Editar produto
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => setConfirmProduct(!confirmProduct)}
                          aria-expanded={confirmProduct}
                        >
                          {product.active ? "Desativar" : "Reativar"}
                        </button>
                      </div>
                      {confirmProduct && (
                        <div className={styles.confirm}>
                          <p>
                            {product.active
                              ? "Desativar preserva variantes, preços e histórico."
                              : "Reativar torna este produto disponível novamente."}
                          </p>
                          <button
                            type="button"
                            className={styles.danger}
                            disabled={busy !== null}
                            onClick={() => toggleProduct(product)}
                          >
                            {busy === "product-status"
                              ? "Salvando…"
                              : "Confirmar " +
                                (product.active ? "desativação" : "reativação")}
                          </button>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => setConfirmProduct(false)}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                      {editingProduct && (
                        <form
                          onSubmit={(event) =>
                            submitProductEdit(event, product)
                          }
                          className={styles.stack}
                        >
                          <Field
                            label="Nome do produto"
                            name="name"
                            defaultValue={product.name}
                            required
                            maxLength={120}
                          />
                          <label className={styles.field}>
                            <span>Descrição (opcional)</span>
                            <textarea
                              name="description"
                              defaultValue={product.description ?? ""}
                              maxLength={2000}
                              rows={3}
                            />
                          </label>
                          <label className={styles.field}>
                            <span>Categoria (opcional)</span>
                            <select
                              name="categoryId"
                              defaultValue={product.categoryId ?? ""}
                            >
                              <option value="">Sem categoria</option>
                              {categories
                                .filter(
                                  (category) =>
                                    category.active ||
                                    category.id === product.categoryId,
                                )
                                .map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                    {category.active ? "" : " (inativa)"}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className={styles.primary}
                            disabled={busy !== null}
                          >
                            {busy === "product-edit"
                              ? "Salvando…"
                              : "Salvar produto"}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                  <div className={styles.sectionHead}>
                    <h3>Variantes e preços</h3>
                    <span className={styles.count}>{storeName}</span>
                  </div>
                  {product.variants.length === 0 ? (
                    <p className={styles.empty}>Nenhuma variante cadastrada.</p>
                  ) : (
                    <ul className={styles.variantList}>
                      {product.variants.map((variant) => (
                        <li
                          key={
                            variant.id +
                            "-" +
                            variant.revision +
                            "-" +
                            (variant.price?.revision ?? "none")
                          }
                          className={styles.variant}
                        >
                          <div className={styles.variantHead}>
                            <div>
                              <strong>{variant.sku}</strong>
                              <p>
                                {[variant.color, variant.size]
                                  .filter(Boolean)
                                  .join(" / ") || "Sem cor e tamanho"}{" "}
                                · {variant.unit}
                              </p>
                            </div>
                            <span
                              className={
                                variant.active ? styles.active : styles.inactive
                              }
                            >
                              {variant.active ? "Ativa" : "Inativa"}
                            </span>
                          </div>
                          {variant.barcode && (
                            <p className={styles.meta}>
                              Código de barras: {variant.barcode}
                            </p>
                          )}
                          <p className={styles.price}>
                            {variant.price
                              ? formatBrlPrice(variant.price.value)
                              : "Sem preço"}
                          </p>
                          {canWrite && (
                            <div className={styles.variantEditors}>
                              <details>
                                <summary>Editar variante</summary>
                                <form
                                  onSubmit={(event) =>
                                    submitVariantEdit(event, variant)
                                  }
                                  className={styles.stack}
                                >
                                  <VariantFields variant={variant} />
                                  <button
                                    className={styles.secondary}
                                    disabled={busy !== null}
                                  >
                                    {busy === "variant-" + variant.id
                                      ? "Salvando…"
                                      : "Salvar variante"}
                                  </button>
                                </form>
                                <button
                                  type="button"
                                  className={styles.danger}
                                  onClick={() => setConfirmVariant(variant.id)}
                                >
                                  {variant.active
                                    ? "Desativar variante"
                                    : "Reativar variante"}
                                </button>
                                {confirmVariant === variant.id && (
                                  <div className={styles.confirm}>
                                    <p>
                                      O histórico desta variante e o preço
                                      cadastrado serão preservados.
                                    </p>
                                    <button
                                      type="button"
                                      className={styles.danger}
                                      disabled={busy !== null}
                                      onClick={() => toggleVariant(variant)}
                                    >
                                      Confirmar
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.linkButton}
                                      onClick={() => setConfirmVariant(null)}
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                )}
                              </details>
                              {product.active && variant.active && (
                                <details>
                                  <summary>
                                    {variant.price
                                      ? "Alterar preço"
                                      : "Informar preço"}
                                  </summary>
                                  <form
                                    onSubmit={(event) =>
                                      submitPrice(event, variant)
                                    }
                                    className={styles.inlineForm}
                                  >
                                    <label className={styles.field}>
                                      <span>
                                        Preço em reais para {storeName}
                                      </span>
                                      <input
                                        name="price"
                                        type="text"
                                        inputMode="decimal"
                                        required
                                        maxLength={13}
                                        pattern="[0-9]{1,10}([,.][0-9]{1,2})?"
                                        defaultValue={
                                          variant.price?.value.replace(
                                            ".",
                                            ",",
                                          ) ?? ""
                                        }
                                        placeholder="59,90"
                                        aria-describedby={
                                          "price-hint-" + variant.id
                                        }
                                      />
                                      <small id={"price-hint-" + variant.id}>
                                        Até dez dígitos inteiros e dois
                                        centavos. Sem preço é diferente de zero.
                                      </small>
                                    </label>
                                    <button
                                      className={styles.secondary}
                                      disabled={busy !== null}
                                    >
                                      {busy === "price-" + variant.id
                                        ? "Salvando…"
                                        : "Salvar preço"}
                                    </button>
                                  </form>
                                </details>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canWrite && product.active && (
                    <details className={styles.addVariant}>
                      <summary>Adicionar variante</summary>
                      <form
                        onSubmit={(event) => submitVariant(event, product)}
                        className={styles.stack}
                      >
                        <VariantFields />
                        <button
                          className={styles.primary}
                          disabled={busy !== null}
                        >
                          {busy === "variant-new"
                            ? "Salvando…"
                            : "Adicionar variante"}
                        </button>
                      </form>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
