import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { ManualAccessError, readDeliveries } from "@/lib/manual/server";
import { DeliveryWorkspace } from "@/packages/ui/manual/workspace";

export default async function DeliveriesPage() {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  let data: Awaited<ReturnType<typeof readDeliveries>> | null = null;
  let loadError: ManualAccessError | null = null;
  try {
    data = await readDeliveries(scope);
  } catch (error) {
    if (!(error instanceof ManualAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data) return <section role="alert"><h1>Entregas e retiradas</h1><p>{loadError?.message}</p><Link href="/app/entregas">Tentar novamente</Link></section>;
  return <DeliveryWorkspace key={access.user.id + scope.organizationId + scope.storeId}
    data={data} scope={scope} userId={access.user.id} storeName={access.active.name} />;
}
