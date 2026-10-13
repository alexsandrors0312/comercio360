import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({ default: "a" }));
import { OperationsOverview } from "../packages/ui/operations/overview";
import type { OperationsOverview as Overview } from "../packages/domain/operations-contracts";

const ready = { status: "ready" as const, data: { items: [], total: 47, page: 1, pageSize: 5 } };
const data: Overview = { sales: ready, orders: ready, stock: ready };
describe("Operational overview", () => {
  it("shows complete source counts and keeps scope and metric limitations visible", () => {
    const html = renderToStaticMarkup(createElement(OperationsOverview, { data, storeName: "Loja fictícia" }));
    expect(html.match(/>47</g)).toHaveLength(3);
    expect(html).toContain("todo o histórico");
    expect(html).toContain("instantes diferentes");
    expect(html).toContain("não representam pagamentos recebidos");
    expect(html).not.toContain("Estado da demonstração");
  });
  it("shows neither fake zero nor commercial cards for hidden or unavailable sources", () => {
    const html = renderToStaticMarkup(createElement(OperationsOverview, { storeName: "Loja", data: { sales: { status: "hidden" }, orders: { status: "hidden" }, stock: { status: "unavailable" } } }));
    expect(html).not.toContain("Vendas confirmadas");
    expect(html).not.toContain("Pedidos abertos");
    expect(html).not.toContain(">0<");
    expect(html).toContain("Consulta indisponível");
  });
});
