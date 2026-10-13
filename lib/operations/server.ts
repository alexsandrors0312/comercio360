import "server-only";
import { listSales } from "../sales/server";
import { listOrders } from "../orders/server";
import { listInventoryStock } from "../inventory/server";
import { operationsReportSchema } from "../../packages/validation/operations";
import type {
  OperationsOverview,
  OperationsReport,
  OperationsScope,
  ReadSection,
} from "../../packages/domain/operations-contracts";

async function section<T>(read: () => Promise<T>): Promise<ReadSection<T>> {
  try {
    return { status: "ready", data: await read() };
  } catch {
    return { status: "unavailable" };
  }
}

/** Presentation capability only; every source reader independently reauthorizes. */
export async function getOperationsOverview(
  scope: OperationsScope,
  commercial: boolean,
): Promise<OperationsOverview> {
  const [sales, orders, stock] = await Promise.all([
    commercial
      ? section(() => listSales(scope, { status: "confirmed", pageSize: 5 }))
      : Promise.resolve({ status: "hidden" } as const),
    commercial
      ? section(() => listOrders(scope, { status: "open", pageSize: 1 }))
      : Promise.resolve({ status: "hidden" } as const),
    section(() => listInventoryStock(scope, { pageSize: 1 })),
  ]);
  return { sales, orders, stock };
}

export class OperationsReadError extends Error {
  constructor(public readonly kind: "invalid" | "denied" | "unavailable") {
    super(kind === "invalid"
      ? "Confira o tipo, o filtro e a página do relatório."
      : kind === "denied"
        ? "Você não tem permissão para consultar este relatório nesta loja."
        : "Não foi possível consultar este relatório. Tente novamente.");
  }
}

export async function getOperationsReport(
  scope: OperationsScope,
  input: unknown,
): Promise<OperationsReport> {
  const parsed = operationsReportSchema.safeParse(input);
  if (!parsed.success) throw new OperationsReadError("invalid");
  const { type, status, query, page } = parsed.data;
  try {
    return type === "sales"
      ? { type, page: await listSales(scope, { status, page, pageSize: 20 }) }
      : { type, page: await listInventoryStock(scope, { query, page, pageSize: 20 }) };
  } catch (error) {
    const kind = error instanceof Error && "kind" in error ? error.kind : null;
    throw new OperationsReadError(kind === "denied" || kind === "invalid" ? kind : "unavailable");
  }
}
