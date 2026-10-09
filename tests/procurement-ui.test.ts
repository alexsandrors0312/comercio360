import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProcurementWorkspace } from "../packages/ui/procurement/workspace";
import type { PurchaseDetail } from "../packages/domain/procurement-contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../app/actions/procurement", () => ({
  saveProcurementSupplier: vi.fn(),
  createPurchaseOrder: vi.fn(),
  receivePurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
  findPurchaseVariants: vi.fn(),
}));
const id = "00000000-0000-4000-8000-000000000001";
const detail: PurchaseDetail = {
  order: {
    id,
    supplierId: id,
    supplierName: "Fornecedor Ágil",
    status: "open",
    revision: "1",
    totalCents: 1999,
    createdAt: "2026-10-09T15:00:00Z",
    receivedAt: null,
    cancellationReason: null,
  },
  items: [
    {
      variantId: id,
      productName: "Camiseta",
      sku: "CAM-P",
      quantity: 1,
      unitCostCents: 1999,
    },
  ],
};
const base = {
  scope: { organizationId: id, storeId: id },
  storeName: "Loja Centro",
  permissions: { canManage: true, canReceive: true },
  suppliers: {
    items: [
      {
        id,
        name: "Fornecedor Ágil",
        contact: "Contato livre",
        active: true,
        revision: "1",
      },
    ],
    page: 1,
    pageSize: 12,
    total: 1,
  },
  orders: { items: [detail.order], page: 1, pageSize: 12, total: 1 },
  selectedOrder: detail,
  query: "",
  status: "all" as const,
};
const render = (
  props: Partial<Parameters<typeof ProcurementWorkspace>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(ProcurementWorkspace, { ...base, ...props }),
  );

describe("Compras: apresentação estática, não comprova interação", () => {
  it("apresenta fornecedor, snapshot, custo e recebimento explícito", () => {
    const html = render();
    for (const text of [
      "Loja Centro",
      "Fornecedor Ágil",
      "CAM-P",
      "R$ 19,99",
      "Receber pedido completo",
      "Conferi todas as quantidades do pedido",
      "Motivo do cancelamento",
      'aria-live="polite"',
    ])
      expect(html).toContain(text);
  });
  it("estoquista consulta e recebe sem gerenciar fornecedor ou pedido", () => {
    const html = render({
      permissions: { canManage: false, canReceive: true },
    });
    expect(html).toContain("Receber pedido completo");
    for (const text of [
      "Novo pedido",
      "Cadastrar fornecedor",
      "Cancelar pedido",
      'name="name"',
    ])
      expect(html).not.toContain(text);
    expect(html).toContain("CAM-P");
  });
  it("comprador cria e cancela sem oferecer recebimento", () => {
    const html = render({
      permissions: { canManage: true, canReceive: false },
    });
    expect(html).toContain("Novo pedido");
    expect(html).toContain("Cadastrar fornecedor");
    expect(html).toContain("Cancelar pedido");
    expect(html).not.toContain("Receber pedido completo");
  });
  it("pedido terminal preserva dados e omite transições", () => {
    const html = render({
      selectedOrder: {
        ...detail,
        order: {
          ...detail.order,
          status: "cancelled",
          cancellationReason: "<script> Motivo",
        },
      },
    });
    expect(html).toContain("Cancelado");
    expect(html).toContain("&lt;script&gt; Motivo");
    expect(html).not.toContain("Receber pedido completo");
    expect(html).not.toContain("Motivo do cancelamento</span>");
  });
  it("oferece estados vazios e conserva filtros nas paginações", () => {
    const empty = render({
      selectedOrder: null,
      orders: { ...base.orders, items: [], total: 0 },
      suppliers: { ...base.suppliers, items: [], total: 0 },
    });
    expect(empty).toContain("Selecione um pedido");
    expect(empty).toContain("Nenhum pedido encontrado");
    expect(empty).toContain("Nenhum fornecedor encontrado");
    const html = render({
      query: "Ágil",
      status: "open",
      orders: { ...base.orders, page: 2, total: 30 },
      suppliers: { ...base.suppliers, page: 2, total: 30 },
    });
    expect(html).toContain(
      "q=%C3%81gil&amp;estado=open&amp;pagina=3&amp;fornecedoresPagina=2",
    );
    expect(html).toContain(
      `q=%C3%81gil&amp;estado=open&amp;pagina=2&amp;fornecedoresPagina=3&amp;pedido=${id}`,
    );
  });
  it("fornecedor inativo permanece consultável e não aparece como opção de novo pedido", () => {
    const html = render({
      suppliers: {
        ...base.suppliers,
        items: [{ ...base.suppliers.items[0], active: false }],
      },
    });
    expect(html).toContain("Inativo");
    expect(html).toContain("Nenhum fornecedor ativo nesta página");
    expect(html).not.toContain(
      `<option value=\"${id}\">Fornecedor Ágil</option>`,
    );
  });
});
