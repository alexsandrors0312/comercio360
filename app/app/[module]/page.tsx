import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/tenancy";
import { navigation } from "@/packages/config/navigation";
import { Dashboard } from "@/packages/ui/dashboard";
import { Construction } from "@/packages/ui/states";
export default async function Module({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const item = navigation.find((n) => n.slug === module);
  if (!item) notFound();
  await requireAccess();
  return module === "visao-geral" ? (
    <Dashboard />
  ) : (
    <Construction label={item.label} />
  );
}
