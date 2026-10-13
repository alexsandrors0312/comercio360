export const SETTINGS_ROLES = [
  "owner",
  "manager",
  "cashier",
  "stockist",
  "buyer",
  "marketing",
  "logistics",
  "driver",
] as const;
export type SettingsRole = (typeof SETTINGS_ROLES)[number];
export const SETTINGS_ROLE_LABELS: Record<SettingsRole, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  cashier: "Caixa",
  stockist: "Estoquista",
  buyer: "Comprador",
  marketing: "Marketing",
  logistics: "Logística",
  driver: "Entregador",
};
export type SettingsScope = { organizationId: string; storeId: string };
export type SettingsStore = {
  id: string;
  name: string;
  active: boolean;
  revision: string;
};
export type SettingsMember = {
  id: string;
  userId: string;
  name: string;
  role: SettingsRole;
  active: boolean;
  revision: string;
  storeIds: string[];
};
export type SettingsInvitation = {
  id: string;
  email: string;
  role: SettingsRole;
  status: "pending" | "accepted" | "revoked";
  revision: string;
  expiresAt: string;
  storeIds: string[];
};
export type SettingsData = {
  organization: { id: string; name: string; revision: string };
  stores: SettingsStore[];
  members: SettingsMember[];
  invitations: SettingsInvitation[];
};
export type SettingsResult = {
  id: string;
  revision: string;
  organizationId?: string;
  storeId?: string;
};
export type SettingsActionResult =
  | { status: "success"; result: SettingsResult }
  | { status: "invalid" | "denied" | "conflict" | "unknown"; message: string };
