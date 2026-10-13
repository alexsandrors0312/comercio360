import { requireAccess } from "@/lib/tenancy";
import { getOperationsOverview } from "@/lib/operations/server";
import { OperationsOverview } from "@/packages/ui/operations/overview";

export default async function OverviewPage() {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  const role = access.memberships.find((member) => member.organization_id === scope.organizationId)?.role;
  const commercial = !!role && ["owner", "manager", "cashier"].includes(role);
  const data = await getOperationsOverview(scope, commercial);
  return <OperationsOverview data={data} storeName={access.active.name} />;
}
