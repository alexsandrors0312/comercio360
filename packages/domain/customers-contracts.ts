export type CustomerScope = { organizationId: string; storeId: string };

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerPage = {
  items: Customer[];
  page: number;
  pageSize: number;
  total: number;
};

/** A sale summary scoped to the selected authorized store; never includes contact data. */
export type CustomerSale = {
  id: string;
  status: "confirmed" | "cancelled";
  totalCents: number;
  createdAt: string;
  cancelledAt: string | null;
};

export type CustomerSalePage = {
  items: CustomerSale[];
  page: number;
  pageSize: number;
  total: number;
};

export type CustomerPermissions = {
  canCreate: boolean;
  canEdit: boolean;
  userId: string;
};

export type SaveCustomerInput = {
  customerId: string | null;
  expectedRevision: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  idempotencyKey: string;
};

export type CustomerSaveResult =
  | { status: "success"; message: string; id: string; revision: string }
  | {
      status: "invalid" | "denied" | "conflict" | "unavailable";
      message: string;
    };

export type CustomerSearchResult =
  | { status: "success"; items: Customer[] }
  | { status: "invalid" | "denied" | "unavailable"; message: string };
