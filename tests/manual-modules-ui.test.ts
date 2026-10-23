import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { brlToCents } from "../packages/validation/manual";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/manual", () => ({ manualAction: vi.fn() }));
import { FinanceWorkspace, DeliveryWorkspace, MarketingWorkspace } from "../packages/ui/manual/workspace";

const id = "11111111-1111-4111-8111-111111111111";
const scope = { organizationId: id, storeId: id };
const shared = { scope, userId: id, storeName: "Loja fictícia" };

describe("Pacotes 010–012: interface local", () => {
  it("interpreta reais em centavos sem arredondar nem aceitar formato ambíguo", () => {
    expect(brlToCents("19,90")).toBe(1990);
    expect(brlToCents("19.9")).toBe(1990);
    expect(brlToCents("0")).toBeNull();
    expect(brlToCents("1.000,00")).toBeNull();
    expect(brlToCents("19,999")).toBeNull();
  });

  it("renderiza financeiro declarado e separa controles do gerente", () => {
    const data = { cashBalanceCents: "0", sales: [], receipts: [], cashEntries: [] };
    const manager = renderToString(createElement(FinanceWorkspace, { ...shared, data, canManage: true }));
    const cashier = renderToString(createElement(FinanceWorkspace, { ...shared, data, canManage: false }));
    expect(manager).toContain("Entrada ou saída de caixa");
    expect(cashier).not.toContain("Entrada ou saída de caixa");
    expect(cashier).toContain("não confirma transferência");
    expect(manager).toContain("disabled");
  });

  it("explica limites de logística e marketing sem disparo externo", () => {
    const deliveries = renderToString(createElement(DeliveryWorkspace, {
      ...shared, data: { sales: [], deliveries: [] },
    }));
    const marketing = renderToString(createElement(MarketingWorkspace, {
      ...shared, data: { campaigns: [] },
    }));
    expect(deliveries).toContain("Sem cotação, rastreamento externo");
    expect(marketing).toContain("Nenhuma mensagem é enviada");
  });
});
