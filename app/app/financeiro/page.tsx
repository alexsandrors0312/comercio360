import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { ManualAccessError, readFinance } from "@/lib/manual/server";
import { FinanceWorkspace } from "@/packages/ui/manual/workspace";

export default async function FinancePage() {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  let data: Awaited<ReturnType<typeof readFinance>> | null = null;
  let loadError: ManualAccessError | null = null;
  try {
    data = await readFinance(scope);
  } catch (error) {
    if (!(error instanceof ManualAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data) return <section role="alert"><h1>Financeiro</h1><p>{loadError?.message}</p><Link href="/app/financeiro">Tentar novamente</Link></section>;
  return <FinanceWorkspace key={access.user.id + scope.organizationId + scope.storeId}
    data={data} scope={scope} userId={access.user.id} storeName={access.active.name}
    canManage={access.memberships.some(m => m.organization_id === scope.organizationId && m.active && ["owner", "manager"].includes(m.role))} />;
}
