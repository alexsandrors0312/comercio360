import { notFound } from "next/navigation";
import { Shell } from "@/packages/ui/shell";
import { Dashboard } from "@/packages/ui/dashboard";
import { AuthenticatedModule, Construction } from "@/packages/ui/states";
import { navigation } from "@/packages/config/navigation";
import { demoOrganizations, demoStores } from "@/mocks/dashboard";
export const dynamic = "force-dynamic";
const authenticatedModules = new Set([
  "vendas",
  "pedidos",
  "produtos",
  "estoque",
  "compras",
  "clientes",
  "relatorios",
  "configuracoes",
  "financeiro",
  "entregas",
  "marketing",
]);
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
      ) : authenticatedModules.has(slug) ? (
        <AuthenticatedModule
          label={slug === "clientes" ? "Clientes" : item.label}
        />
      ) : (
        <Construction label={item.label} />
      )}
    </Shell>
  );
}
