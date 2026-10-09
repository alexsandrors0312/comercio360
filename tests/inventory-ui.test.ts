import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryWorkspace } from "../packages/ui/inventory/workspace";
import type { InventoryItem } from "../packages/domain/inventory-contracts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/inventory", () => ({
  recordInventoryMovement: vi.fn(),
}));

const scope = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
};
const item: InventoryItem = {
  variantId: "00000000-0000-4000-8000-000000000003",
  productName: "Camiseta básica",
  sku: "CAM-AZ-P",
  color: "Azul",
  size: "P",
  active: true,
  quantity: 0,
  revision: "0",
};
const base = {
  scope,
  storeName: "Loja Centro",
  stock: { items: [item], page: 1, pageSize: 12, total: 1 },
  selectedItem: item,
  history: { items: [], page: 1, pageSize: 12, total: 0 },
  query: "",
  canWrite: true,
};
const render = (
  props: Partial<Parameters<typeof InventoryWorkspace>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(InventoryWorkspace, { ...base, ...props }),
  );

describe("Estoque: apresentação estática (não comprova interação)", () => {
  it("identifica loja, SKU, atributos e saldo zero real", () => {
    const html = render();
    for (const text of [
      "Loja Centro",
      "CAM-AZ-P",
      "Azul",
      "Saldo atual:",
      "0 unidades",
      "Nenhuma movimentação registrada",
      'aria-current="true"',
    ])
      expect(html).toContain(text);
  });
  it("oferece rótulos, ajuda e estado de mensagem no formulário autorizado", () => {
    const html = render();
    for (const text of [
      "Tipo de movimentação",
      "Quantidade (unidades)",
      "Motivo da movimentação",
      "quantity-help",
      "reason-help",
      'aria-live="polite"',
      "Registrar movimentação",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("idempotencyKey");
  });
  it("consulta sem escrita mantém histórico e omite formulário", () => {
    const html = render({ canWrite: false });
    expect(html).toContain("Seu acesso permite consultar saldos e histórico");
    expect(html).toContain("Histórico de movimentações");
    expect(html).not.toContain("Registrar movimentação");
    expect(html).not.toContain('name="quantity"');
  });
  it("cadastro inativo preserva histórico e bloqueia apresentação de nova movimentação", () => {
    const inactive = { ...item, active: false, quantity: 10 };
    const html = render({
      stock: { ...base.stock, items: [inactive] },
      selectedItem: inactive,
    });
    expect(html).toContain("Cadastro inativo");
    expect(html).toContain("10 unidades");
    expect(html).not.toContain("Registrar movimentação");
  });
  it("distingue lista vazia, busca vazia e ausência de seleção", () => {
    const stock = { ...base.stock, items: [], total: 0 };
    expect(render({ stock, selectedItem: null })).toContain(
      "Nenhuma variante cadastrada",
    );
    const search = render({ stock, query: "<script>", selectedItem: null });
    expect(search).toContain("Nenhum SKU encontrado");
    expect(search).toContain("Selecione um SKU");
    expect(search).toContain("&lt;script&gt;");
    expect(search).not.toContain("<script>");
  });
  it("paginação e seleção descartam histórico anterior e conservam busca", () => {
    const html = render({
      query: "camisa azul",
      stock: { ...base.stock, total: 25, page: 2 },
      history: { items: [], total: 25, pageSize: 12, page: 2 },
    });
    expect(html).toContain('q=camisa+azul&amp;pagina=3"');
    expect(html).toContain(
      `q=camisa+azul&amp;pagina=2&amp;variante=${item.variantId}\"`,
    );
    expect(html).toContain(
      `q=camisa+azul&amp;pagina=2&amp;variante=${item.variantId}&amp;historico=3`,
    );
  });
  it("escapa motivo e apresenta a movimentação imutável com saldo após", () => {
    const html = render({
      history: {
        ...base.history,
        total: 1,
        items: [
          {
            id: "movement",
            kind: "exit",
            quantity: 2,
            reason: "<img src=x> Ajuste",
            balanceAfter: 8,
            createdAt: "2026-10-09T15:00:00Z",
          },
        ],
      },
    });
    expect(html).toContain("Saída de 2 unidades");
    expect(html).toContain("&lt;img src=x&gt; Ajuste");
    expect(html).toContain("Saldo após movimento: 8 unidades");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Excluir movimentação");
  });
});
