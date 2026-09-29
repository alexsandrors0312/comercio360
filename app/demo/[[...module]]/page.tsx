import { notFound } from "next/navigation";
import { Shell } from "@/packages/ui/shell";
import { Dashboard } from "@/packages/ui/dashboard";
import { Construction } from "@/packages/ui/states";
import { navigation } from "@/packages/config/navigation";
import { demoOrganizations, demoStores } from "@/mocks/dashboard";
export const dynamic = "force-dynamic";
export default async function Demo({
  params,
}: {
  params: Promise<{ module?: string[] }>;
}) {
  if (process.env.DEMO_ENABLED === "false") notFound();
  const parts = (await params).module;
  const slug = parts?.[0] ?? "visao-geral";
  const item = navigation.find((n) => n.slug === slug);
  if (!item || (parts?.length ?? 0) > 1) notFound();
  return (
    <Shell
      demo
      organizations={demoOrganizations}
      stores={demoStores}
      active={demoStores[0]}
    >
      {slug === "visao-geral" ? (
        <Dashboard />
      ) : (
        <Construction label={item.label} />
      )}
    </Shell>
  );
}
