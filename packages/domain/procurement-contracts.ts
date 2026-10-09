export type ProcurementScope = { organizationId: string; storeId: string };
export type PurchaseStatus = "open" | "received" | "cancelled";
export type Supplier = {
  id: string;
  name: string;
  contact: string;
  active: boolean;
  revision: string;
};
export type SupplierPage = {
  items: Supplier[];
  page: number;
  pageSize: number;
  total: number;
};
export type PurchaseOrder = {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  revision: string;
  totalCents: number;
  createdAt: string;
  receivedAt: string | null;
  cancellationReason: string | null;
};
export type PurchaseItem = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCostCents: number;
};
export type PurchasePage = {
  items: PurchaseOrder[];
  page: number;
  pageSize: number;
  total: number;
};
export type PurchaseDetail = { order: PurchaseOrder; items: PurchaseItem[] };
export type ProcurementPermissions = {
  canManage: boolean;
  canReceive: boolean;
};
export type SupplierInput = {
  supplierId: string;
  name: string;
  contact: string;
  active: boolean;
  expectedRevision: string;
  idempotencyKey: string;
};
export type PurchaseLineInput = {
  variantId: string;
  quantity: string;
  unitCost: string;
};
export type PurchaseInput = {
  supplierId: string;
  items: PurchaseLineInput[];
  idempotencyKey: string;
};
export type PurchaseTransitionInput = {
  orderId: string;
  expectedRevision: string;
  idempotencyKey: string;
};
export type PurchaseCancelInput = PurchaseTransitionInput & { reason: string };
export type ProcurementResult =
  | { status: "success"; message: string; id: string; revision: string }
  | {
      status: "invalid" | "denied" | "conflict" | "duplicate" | "unavailable";
      message: string;
    };
export type ProcurementVariant = {
  variantId: string;
  productName: string;
  sku: string;
};
export type VariantSearchResult =
  | { status: "success"; items: ProcurementVariant[] }
  | { status: "invalid" | "denied" | "unavailable"; message: string };
