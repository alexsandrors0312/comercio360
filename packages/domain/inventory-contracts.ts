/** Public presentation contracts for the local Inventory 003 module. */
export type InventoryScope = { organizationId: string; storeId: string };
export type InventoryKind = "entry" | "exit";
export type InventoryItem = {
  variantId: string;
  productName: string;
  sku: string;
  color: string | null;
  size: string | null;
  active: boolean;
  quantity: number;
  revision: string;
};
export type InventoryStockPage = {
  items: InventoryItem[];
  page: number;
  pageSize: number;
  total: number;
};
export type InventoryMovement = {
  id: string;
  kind: InventoryKind;
  quantity: number;
  reason: string;
  balanceAfter: number;
  createdAt: string;
};
export type InventoryHistoryPage = {
  items: InventoryMovement[];
  page: number;
  pageSize: number;
  total: number;
};
export type InventoryMovementInput = {
  variantId: string;
  kind: InventoryKind;
  quantity: string;
  reason: string;
  expectedRevision: string;
  idempotencyKey: string;
};
export type InventoryMutationResult =
  | {
      status: "success";
      message: string;
      id: string;
      revision: string;
      quantity: number;
    }
  | {
      status:
        "invalid" | "denied" | "conflict" | "insufficient" | "unavailable";
      message: string;
    };
