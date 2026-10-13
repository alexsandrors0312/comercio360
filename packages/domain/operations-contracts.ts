import type { SalePage } from "./sales-contracts";
import type { OrderPage } from "./orders-contracts";
import type { InventoryStockPage } from "./inventory-contracts";

export type OperationsScope = { organizationId: string; storeId: string };
export type ReadSection<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable" }
  | { status: "hidden" };
export type OperationsOverview = {
  sales: ReadSection<SalePage>;
  orders: ReadSection<OrderPage>;
  stock: ReadSection<InventoryStockPage>;
};
export type OperationsReport =
  | { type: "sales"; page: SalePage }
  | { type: "stock"; page: InventoryStockPage };
