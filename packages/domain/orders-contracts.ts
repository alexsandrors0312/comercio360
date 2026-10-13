export type OrderScope = { organizationId: string; storeId: string };
export type OrderChannel = "counter" | "whatsapp";
export type OrderStatus = "open" | "fulfilled" | "cancelled";

export type OrderPermissions = {
  canCreate: boolean;
  canFulfill: boolean;
  canCancel: boolean;
  userId: string;
};

export type Order = {
  id: string;
  channel: OrderChannel;
  status: OrderStatus;
  revision: string;
  customerId: string | null;
  customerNameSnapshot: string | null;
  itemCount: number;
  totalCents: number;
  saleId: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

export type OrderItem = {
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
};

export type OrderPage = {
  items: Order[];
  page: number;
  pageSize: number;
  total: number;
};

export type OrderDetail = {
  order: Order;
  items: OrderItem[];
};

export type OrderLineInput = {
  variantId: string;
  quantity: string;
  expectedUnitPriceCents: number;
};

export type CreateOrderInput = {
  channel: OrderChannel;
  customerId: string | null;
  items: OrderLineInput[];
  idempotencyKey: string;
};

export type CancelOrderInput = {
  orderId: string;
  expectedRevision: string;
  reason: string;
  idempotencyKey: string;
};

export type FulfillOrderInput = {
  orderId: string;
  expectedRevision: string;
  idempotencyKey: string;
};

export type OrderResult =
  | {
      status: "success";
      message: string;
      id: string;
      revision: string;
      saleId: string | null;
    }
  | {
      status:
        "invalid" | "denied" | "conflict" | "insufficient" | "unavailable";
      message: string;
    };
