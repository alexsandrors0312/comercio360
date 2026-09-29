import { requireAccess } from "@/lib/tenancy";
import { Shell } from "@/packages/ui/shell";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requireAccess();
  return (
    <Shell
      organizations={access.organizations}
      stores={access.stores}
      active={access.active}
      demo={false}
    >
      {children}
    </Shell>
  );
}
