import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "../packages/ui/sales/workspace";
import {
  saleAttemptKey,
  loadSaleAttempt,
  persistSaleAttempt,
  clearSaleAttempt,
  parseSaleAttempt,
  type AttemptStorage,
  type SaleAttempt,
} from "../packages/ui/sales/attempt";
import type { SaleDetail } from "../packages/domain/sales-contracts";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../app/actions/sales", () => ({
  confirmSale: vi.fn(),
  cancelSale: vi.fn(),
  findSaleVariants: vi.fn(),
}));
const id = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002";
const detail: SaleDetail = {
  sale: {
    id,
    status: "confirmed",
    revision: "1",
    totalCents: 1999,
    createdAt: "2026-10-09T15:00:00Z",
    cancelledAt: null,
    cancellationReason: null,
  },
  items: [
    {
      variantId: id,
      productName: "Camiseta snapshot",
      sku: "CAM-P",
      quantity: 1,
      unitPriceCents: 1999,
    },
  ],
};
const base = {
  scope: { organizationId: id, storeId: id },
  storeName: "Loja Centro",
  permissions: { canConfirm: true, canCancel: true, userId: user },
  sales: { items: [detail.sale], page: 1, pageSize: 12, total: 1 },
  selectedSale: detail,
  query: "",
  status: "all" as const,
};
const render = (props: Partial<Parameters<typeof SalesWorkspace>[0]> = {}) =>
  renderToStaticMarkup(createElement(SalesWorkspace, { ...base, ...props }));
describe("PDV SSR presentation, not interaction evidence", () => {
  it("disables every client operation until hydration and storage recovery", () => {
    const html = render();
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    const client = forms.filter((form) => !form.includes('method="get"'));
    expect(client).toHaveLength(3);
    for (const form of client) {
      const buttons = form.match(/<button\b[^>]*>/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((button) => button.includes('disabled=""'))).toBe(
        true,
      );
    }
    expect(client.find((form) => form.includes('name="variantQuery"'))).toMatch(
      /<input\b(?=[^>]*name="variantQuery")(?=[^>]*disabled="")[^>]*>/,
    );
    expect(client.find((form) => form.includes('name="returned"'))).toContain(
      '<fieldset disabled="">',
    );
    expect(html).toContain("<noscript>");
    expect(html).toContain("Ative o JavaScript para confirmar");
    expect(forms.find((form) => form.includes('method="get"'))).not.toContain(
      'disabled=""',
    );
  });
  it("shows snapshots, cents, explicit sale and full-return confirmations", () => {
    const html = render();
    for (const text of [
      "Loja Centro",
      "CAM-P",
      "R$ 19,99",
      "Conferi os itens, quantidades e preços desta venda",
      "Confirmo que todas as mercadorias retornaram ao estoque",
      "Não realiza estorno de pagamento",
      "Motivo do cancelamento",
      "Confirmar venda e baixar estoque",
      'aria-live="assertive"',
    ])
      expect(html).toContain(text);
  });
  it("cashier has a sale cart and detail without cancellation or purchase cost fields", () => {
    const html = render({
      permissions: { ...base.permissions, canCancel: false },
    });
    expect(html).toContain("Nova venda");
    expect(html).toContain("CAM-P");
    for (const text of [
      "Cancelar venda",
      "Motivo do cancelamento</span>",
      "Custo unitário",
      "Fornecedor do pedido",
    ])
      expect(html).not.toContain(text);
  });
  it("terminal cancellation preserves escaped reason and omits transitions", () => {
    const html = render({
      selectedSale: {
        ...detail,
        sale: {
          ...detail.sale,
          status: "cancelled",
          cancelledAt: "2026-10-09T16:00:00Z",
          cancellationReason: "<script> Retorno fictício",
        },
      },
    });
    expect(html).toContain("&lt;script&gt; Retorno fictício");
    expect(html).toContain("Cancelada em");
    expect(html).not.toContain('aria-label="Cancelar venda"');
  });
  it("supports empty results and stable filtered pagination", () => {
    const empty = render({
      selectedSale: null,
      sales: { ...base.sales, items: [], total: 0 },
    });
    expect(empty).toContain("Nenhuma venda encontrada");
    expect(empty).toContain("Selecione uma venda");
    const html = render({
      query: "Ágil",
      status: "confirmed",
      sales: { ...base.sales, page: 2, total: 30 },
    });
    expect(html).toContain("q=%C3%81gil&amp;estado=confirmed&amp;pagina=3");
  });
});
describe("PDV pending attempt persistence", () => {
  const attempt: SaleAttempt = {
    kind: "confirm",
    payload: {
      items: [{ variantId: id, quantity: " 2 ", expectedUnitPriceCents: 0 }],
      idempotencyKey: user,
    },
  };
  function memory(): AttemptStorage {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
  }
  it("retains original payload and UUID across reload, scoped to user/tenant/store", () => {
    const storage = memory(),
      key = saleAttemptKey(base.scope, user);
    persistSaleAttempt(storage, key, attempt);
    expect(loadSaleAttempt(storage, key)).toEqual(attempt);
    expect(loadSaleAttempt(storage, saleAttemptKey(base.scope, id))).toBeNull();
    expect(
      loadSaleAttempt(
        storage,
        saleAttemptKey({ ...base.scope, storeId: user }, user),
      ),
    ).toBeNull();
    expect(
      loadSaleAttempt(
        storage,
        saleAttemptKey({ ...base.scope, organizationId: user }, user),
      ),
    ).toBeNull();
    clearSaleAttempt(storage, key);
    expect(loadSaleAttempt(storage, key)).toBeNull();
  });
  it("preserves cancellation CAS/reason and rejects malformed or additional data", () => {
    const cancel: SaleAttempt = {
      kind: "cancel",
      payload: {
        saleId: id,
        expectedRevision: "1",
        reason: " Retorno fictício ",
        idempotencyKey: user,
      },
    };
    expect(parseSaleAttempt(cancel)).toEqual(cancel);
    for (const invalid of [
      {},
      { ...attempt, secret: "forbidden" },
      { ...attempt, payload: { ...attempt.payload, token: "forbidden" } },
      { ...attempt, payload: { ...attempt.payload, idempotencyKey: "bad" } },
    ])
      expect(() => parseSaleAttempt(invalid)).toThrow();
  });
  it("fails closed when storage is unavailable, corrupted or silently discards writes", () => {
    const bad = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    expect(() => loadSaleAttempt(bad, "key")).toThrow();
    expect(() => persistSaleAttempt(bad, "key", attempt)).toThrow();
    expect(() => clearSaleAttempt(bad, "key")).toThrow();
    const corrupted = memory();
    corrupted.setItem("key", "{bad");
    expect(() => loadSaleAttempt(corrupted, "key")).toThrow();
    expect(() =>
      persistSaleAttempt(
        { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        "key",
        attempt,
      ),
    ).toThrow();
    const stale = memory();
    persistSaleAttempt(stale, "key", attempt);
    expect(() =>
      clearSaleAttempt({ ...stale, removeItem: () => {} }, "key"),
    ).toThrow();
  });
  it("rejects whitespace-only or two-codepoint cancellation reasons before persistence", () => {
    const storage = memory();
    for (const reason of ["   ", "😀😀"]) {
      const invalid: SaleAttempt = {
        kind: "cancel",
        payload: {
          saleId: id,
          expectedRevision: "1",
          reason,
          idempotencyKey: user,
        },
      };
      expect(() => parseSaleAttempt(invalid)).toThrow();
      expect(storage.getItem("key")).toBeNull();
    }
    const valid: SaleAttempt = {
      kind: "cancel",
      payload: {
        saleId: id,
        expectedRevision: "1",
        reason: "😀😀😀",
        idempotencyKey: user,
      },
    };
    expect(parseSaleAttempt(valid)).toEqual(valid);
  });
});
