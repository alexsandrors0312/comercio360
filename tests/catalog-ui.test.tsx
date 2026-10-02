import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogWorkspace } from "../packages/ui/catalog/workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../app/actions/catalog", () => ({
  createCatalogCategory: vi.fn(),
  createCatalogProduct: vi.fn(),
  createCatalogVariant: vi.fn(),
  setCatalogPrice: vi.fn(),
  updateCatalogCategory: vi.fn(),
  updateCatalogProduct: vi.fn(),
  updateCatalogVariant: vi.fn(),
}));

const scope = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
};
const product = {
  id: "00000000-0000-4000-8000-000000000003",
  name: "Camiseta básica",
  description: null,
  categoryId: null,
  active: true,
  revision: "1",
  hasCover: false,
  variants: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      sku: "CAM-AZ-P",
      color: "Azul",
      size: "P",
      unit: "UN" as const,
      barcode: null,
      active: true,
      revision: "1",
      price: null,
    },
  ],
};

function render(canWrite: boolean) {
  return renderToStaticMarkup(
    createElement(CatalogWorkspace, {
      scope,
      storeName: "Loja Centro",
      categories: [],
      products: {
        items: [
          {
            id: product.id,
            name: product.name,
            description: null,
            categoryId: null,
            active: true,
            revision: "1",
            priceFrom: null,
          },
        ],
        page: 1,
        pageSize: 12,
        total: 1,
      },
      product,
      selectedId: product.id,
      filters: { query: "", categoryId: null, status: "active" },
      canWrite,
    }),
  );
}

describe("Catálogo: apresentação com escopo de loja", () => {
  it("mostra ausência de preço sem transformar em zero e identifica a loja", () => {
    const html = render(false);
    expect(html).toContain("Sem preço");
    expect(html).toContain("Loja Centro");
    expect(html).not.toContain("R$ 0,00");
  });

  it("não oferece controles de alteração a quem só consulta", () => {
    const html = render(false);
    expect(html).not.toContain("Novo produto");
    expect(html).not.toContain("Editar produto");
    expect(html).not.toContain("Informar preço");
    expect(html).not.toContain("Enviar capa");
    expect(html).toContain("CAM-AZ-P");
  });

  it("oferece edição de produto e preço ao papel autorizado pela camada de servidor", () => {
    const html = render(true);
    expect(html).toContain("Novo produto");
    expect(html).toContain("Editar produto");
    expect(html).toContain("Informar preço");
    expect(html).toContain("Enviar capa");
  });
});
