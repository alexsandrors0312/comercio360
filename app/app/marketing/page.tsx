import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { ManualAccessError, readMarketing } from "@/lib/manual/server";
import { MarketingWorkspace } from "@/packages/ui/manual/workspace";

export default async function MarketingPage() {
  const access = await requireAccess();
  const scope = { organizationId: access.active.organization_id, storeId: access.active.id };
  let data: Awaited<ReturnType<typeof readMarketing>> | null = null;
  let loadError: ManualAccessError | null = null;
  try {
    data = await readMarketing(scope);
  } catch (error) {
    if (!(error instanceof ManualAccessError)) throw error;
    loadError = error;
  }
  if (loadError || !data) return <section role="alert"><h1>Marketing</h1><p>{loadError?.message}</p><Link href="/app/marketing">Tentar novamente</Link></section>;
  return <MarketingWorkspace key={access.user.id + scope.organizationId + scope.storeId}
    data={data} scope={scope} userId={access.user.id} storeName={access.active.name} />;
}
