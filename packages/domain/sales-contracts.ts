export type SalesScope = { organizationId: string; storeId: string };
export type SaleStatus = "confirmed" | "cancelled";
export type SalesPermissions = {
  canConfirm: boolean;
  canCancel: boolean;
  userId: string;
};
export type SaleVariant = {
  variantId: string;
  productName: string;
  sku: string;
  color: string | null;
  size: string | null;
  unitPriceCents: number | null;
  quantity: number;
};
export type SaleVariantPage = {
  items: SaleVariant[];
  page: number;
  pageSize: number;
  total: number;
};
export type Sale = {
  id: string;
  status: SaleStatus;
  revision: string;
  totalCents: number;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
};
export type SaleItem = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
};
export type SalePage = {
  items: Sale[];
  page: number;
  pageSize: number;
  total: number;
};
export type SaleDetail = {
  sale: Sale;
  items: SaleItem[];
  customer: { id: string; name: string } | null;
};
export type SaleLineInput = {
  variantId: string;
  quantity: string;
  expectedUnitPriceCents: number;
};
export type SaleInput = {
  items: SaleLineInput[];
  idempotencyKey: string;
  customerId?: string | null;
};
export type SaleCancelInput = {
  saleId: string;
  expectedRevision: string;
  reason: string;
  idempotencyKey: string;
};
export type SalesResult =
  | { status: "success"; message: string; id: string; revision: string }
  | {
      status:
        "invalid" | "denied" | "conflict" | "insufficient" | "unavailable";
      message: string;
    };
export type SaleVariantSearchResult =
  | { status: "success"; items: SaleVariant[] }
  | { status: "invalid" | "denied" | "unavailable"; message: string };
