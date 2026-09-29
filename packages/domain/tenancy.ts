export type Store = { id: string; organization_id: string; name: string };
export type Organization = { id: string; name: string };
export type Membership = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  active: boolean;
};
// Stores must already be filtered by database authorization (RLS).
export function selectableOrganizations(
  organizations: Organization[],
  stores: Store[],
): Organization[] {
  const authorized = new Set(stores.map((store) => store.organization_id));
  return organizations.filter((organization) =>
    authorized.has(organization.id),
  );
}
export function selectContext(
  stores: Store[],
  organizationId?: string,
  storeId?: string,
): Store | null {
  if (storeId)
    return (
      stores.find(
        (s) =>
          s.id === storeId &&
          (!organizationId || s.organization_id === organizationId),
      ) ?? null
    );
  return (
    stores.find(
      (s) => !organizationId || s.organization_id === organizationId,
    ) ?? null
  );
}
