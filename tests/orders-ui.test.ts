import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OrdersWorkspace } from "../packages/ui/orders/workspace";
import {
  clearOrderAttempt,
  loadOrderAttempt,
  orderAttemptKey,
  parseOrderAttempt,
  persistOrderAttempt,
  type OrderAttempt,
  type OrderAttemptStorage,
} from "../packages/ui/orders/attempt";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../app/actions/orders", () => ({
  createOrder: vi.fn(), cancelOrder: vi.fn(), fulfillOrder: vi.fn(), searchOrders: vi.fn(),
}));
vi.mock("../app/actions/customers", () => ({ findCustomers: vi.fn() }));
vi.mock("../app/actions/sales", () => ({ findSaleVariants: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const scope = { organizationId: id, storeId: id };
const order = {
  id, channel: "counter" as const, status: "open" as const, revision: "1",
  customerId: null, customerNameSnapshot: null, itemCount: 1, totalCents: 1999,
  saleId: null, createdAt: "2026-10-10T12:00:00Z", fulfilledAt: null,
  cancelledAt: null, cancellationReason: null,
};
const base = {
  scope, storeName: "Loja Centro",
  permissions: { canCreate: true, canFulfill: true, canCancel: true, userId: user },
  orders: { items: [order], page: 1, pageSize: 20, total: 1 },
  selectedOrder: {
    order,
    items: [{ variantId: id, productName: "Produto fictício", sku: "SKU-TEST", quantity: 1, unitPriceCents: 1999 }],
  },
};
const render = (props: Partial<Parameters<typeof OrdersWorkspace>[0]> = {}) =>
  renderToStaticMarkup(createElement(OrdersWorkspace, { ...base, ...props }));

describe("Pedidos SSR presentation", () => {
  it("keeps all mutation controls inert until storage recovery after hydration", () => {
    const html = render();
    expect(html).toContain('aria-label="Capturar pedido"');
    expect(html).toContain('aria-label="Concluir pedido em venda"');
    expect(html).toContain('aria-label="Cancelar pedido"');
    expect(html.match(/<fieldset disabled=""/g)).toHaveLength(3);
    expect(html).toContain("Ative o JavaScript");
  });
  it("limits cashier to capture, consultation and fulfillment", () => {
    const html = render({ permissions: { ...base.permissions, canCancel: false } });
    expect(html).toContain("Registrar pedido");
    expect(html).toContain("Concluir pedido em venda");
    expect(html).not.toContain('aria-label="Cancelar pedido"');
  });
  it("escapes snapshots and keeps contact out of links and forms", () => {
    const html = render({ selectedOrder: {
      ...base.selectedOrder,
      order: { ...order, customerNameSnapshot: "<script>" },
    }});
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('method="get"');
    expect(html).not.toContain("?telefone=");
    expect(html).toContain('aria-label="Filtrar pedidos"');
  });
});

function memory(): OrderAttemptStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
const attempt: OrderAttempt = {
  kind: "create",
  payload: {
    channel: "whatsapp", customerId: id,
    items: [{ variantId: id, quantity: "1", expectedUnitPriceCents: 1999 }],
    idempotencyKey: user,
  },
};
describe("Pedidos pending attempt storage", () => {
  it("preserves exact input and key in user, organization and store scope", () => {
    const storage = memory();
    const key = orderAttemptKey(scope, user);
    persistOrderAttempt(storage, key, attempt);
    expect(loadOrderAttempt(storage, key)).toEqual(attempt);
    expect(loadOrderAttempt(storage, orderAttemptKey(scope, id))).toBeNull();
    expect(loadOrderAttempt(storage, orderAttemptKey({ ...scope, storeId: user }, user))).toBeNull();
    expect(loadOrderAttempt(storage, orderAttemptKey({ ...scope, organizationId: user }, user))).toBeNull();
    clearOrderAttempt(storage, key);
    expect(loadOrderAttempt(storage, key)).toBeNull();
  });
  it("rejects extra data, invalid WhatsApp customer and lost storage writes", () => {
    expect(() => parseOrderAttempt({ ...attempt, extra: true })).toThrow();
    expect(() => parseOrderAttempt({ ...attempt, payload: { ...attempt.payload, customerId: null } })).toThrow();
    expect(() => parseOrderAttempt({ ...attempt, payload: { ...attempt.payload, idempotencyKey: "bad" } })).toThrow();
    const unavailable: OrderAttemptStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(() => persistOrderAttempt(unavailable, "key", attempt)).toThrow();
  });
  it("recovers cancel and fulfill CAS attempts without changing input", () => {
    const storage = memory();
    const key = orderAttemptKey(scope, user);
    const fulfill: OrderAttempt = { kind: "fulfill", payload: { orderId: id, expectedRevision: "1", idempotencyKey: user } };
    persistOrderAttempt(storage, key, fulfill);
    expect(loadOrderAttempt(storage, key)).toEqual(fulfill);
    const cancel: OrderAttempt = { kind: "cancel", payload: { orderId: id, expectedRevision: "1", reason: "Cliente desistiu", idempotencyKey: user } };
    persistOrderAttempt(storage, key, cancel);
    expect(loadOrderAttempt(storage, key)).toEqual(cancel);
  });
});
