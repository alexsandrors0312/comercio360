import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomersWorkspace } from "../packages/ui/customers/workspace";
import {
  clearCustomerAttempt,
  customerAttemptKey,
  loadCustomerAttempt,
  parseCustomerAttempt,
  persistCustomerAttempt,
  type CustomerAttempt,
  type CustomerAttemptStorage,
} from "../packages/ui/customers/attempt";
import {
  parseSaleAttempt,
  persistSaleAttempt,
  loadSaleAttempt,
} from "../packages/ui/sales/attempt";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../app/actions/customers", () => ({
  saveCustomer: vi.fn(),
  findCustomers: vi.fn(),
  searchCustomerDirectory: vi.fn(),
}));

const id = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const customer = {
  id,
  name: "Cliente fictícia",
  phone: "11999999999",
  email: "cliente@example.test",
  active: true,
  revision: "1",
  createdAt: "2026-10-10T12:00:00Z",
  updatedAt: "2026-10-10T12:00:00Z",
};
const base = {
  scope: { organizationId: id, storeId: id },
  storeName: "Loja Centro",
  permissions: { canCreate: true, canEdit: true, userId: user },
  customers: { items: [customer], page: 1, pageSize: 20, total: 1 },
  selectedCustomer: customer,
  customerSales: {
    items: [
      {
        id,
        status: "confirmed" as const,
        totalCents: 1999,
        createdAt: "2026-10-10T12:00:00Z",
        cancelledAt: null,
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  },
};
const render = (
  props: Partial<Parameters<typeof CustomersWorkspace>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(CustomersWorkspace, { ...base, ...props }),
  );

describe("Clientes SSR presentation", () => {
  it("keeps create and edit controls disabled before browser storage recovery", () => {
    const html = render();
    expect(html).toContain('aria-label="Cadastrar cliente"');
    expect(html).toContain('aria-label="Editar cliente"');
    expect(html.match(/<fieldset disabled="">/g)).toHaveLength(2);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Cadastrar cliente<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Salvar alterações<\/button>/,
    );
    expect(html).toContain("Ative o JavaScript");
  });
  it("limits cashier to create, consultation and selected-store sales", () => {
    const html = render({
      permissions: { canCreate: true, canEdit: false, userId: user },
    });
    expect(html).toContain("Cadastrar cliente");
    expect(html).toContain("Vendas nesta loja");
    expect(html).not.toContain("Salvar alterações");
    expect(html).not.toContain("Inativar cliente");
  });
  it("escapes customer fields and supports filtered pagination and empty history", () => {
    const html = render({
      selectedCustomer: { ...customer, name: "<script>" },
      customers: { ...base.customers, page: 2, total: 61 },
      customerSales: { ...base.customerSales, items: [], total: 0 },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Próxima página");
    expect(html).not.toContain("method=\"get\"");
    expect(html).not.toContain("?q=");
    expect(html).toContain("Nenhuma venda deste cliente nesta loja");
  });
});

function memory(): CustomerAttemptStorage {
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
const attempt: CustomerAttempt = {
  kind: "save",
  payload: {
    customerId: id,
    expectedRevision: "1",
    name: "Cliente fictícia",
    phone: "11999999999",
    email: "cliente@example.test",
    active: false,
    idempotencyKey: user,
  },
};
describe("Clientes pending attempt storage", () => {
  it("preserves the exact contact, CAS and UUID across reload in the identity scope", () => {
    const storage = memory();
    const key = customerAttemptKey(base.scope, user);
    persistCustomerAttempt(storage, key, attempt);
    expect(loadCustomerAttempt(storage, key)).toEqual(attempt);
    expect(
      loadCustomerAttempt(storage, customerAttemptKey(base.scope, id)),
    ).toBeNull();
    expect(
      loadCustomerAttempt(
        storage,
        customerAttemptKey({ ...base.scope, storeId: user }, user),
      ),
    ).toBeNull();
    expect(
      loadCustomerAttempt(
        storage,
        customerAttemptKey({ ...base.scope, organizationId: user }, user),
      ),
    ).toBeNull();
    clearCustomerAttempt(storage, key);
    expect(loadCustomerAttempt(storage, key)).toBeNull();
  });
  it("rejects extra fields, malformed identity and lost writes", () => {
    for (const invalid of [
      { ...attempt, token: "unexpected" },
      { ...attempt, payload: { ...attempt.payload, token: "unexpected" } },
      { ...attempt, payload: { ...attempt.payload, idempotencyKey: "bad" } },
    ])
      expect(() => parseCustomerAttempt(invalid)).toThrow();
    const bad: CustomerAttemptStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(() => persistCustomerAttempt(bad, "key", attempt)).toThrow();
  });
});

describe("PDV optional customer attempt compatibility", () => {
  const lines = [
    { variantId: id, quantity: "1", expectedUnitPriceCents: 1999 },
  ];
  it("keeps the historical clientless payload byte shape and replays selected customer", () => {
    const storage = memory();
    const historical = {
      kind: "confirm" as const,
      payload: { items: lines, idempotencyKey: user },
    };
    persistSaleAttempt(storage, "sale", historical);
    expect(storage.getItem("sale")).toBe(JSON.stringify(historical));
    expect(loadSaleAttempt(storage, "sale")).toEqual(historical);
    const linked = {
      kind: "confirm" as const,
      payload: { items: lines, customerId: id, idempotencyKey: user },
    };
    expect(parseSaleAttempt(linked)).toEqual(linked);
    persistSaleAttempt(storage, "sale", linked);
    expect(loadSaleAttempt(storage, "sale")).toEqual(linked);
    expect(() =>
      parseSaleAttempt({
        ...linked,
        payload: { ...linked.payload, customerId: "bad" },
      }),
    ).toThrow();
  });
});
