import Link from "next/link";
import { requireAccess } from "@/lib/tenancy";
import { readSettings, SettingsError } from "@/lib/settings/server";
import { SettingsWorkspace } from "@/packages/ui/settings/workspace";
import type { SettingsData } from "@/packages/domain/settings-contracts";
export default async function SettingsPage() {
  const access = await requireAccess();
  const scope = {
    organizationId: access.active.organization_id,
    storeId: access.active.id,
  };
  let data: SettingsData;
  try {
    data = await readSettings(scope);
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
    return (
      <section>
        <h1>Configurações</h1>
        <h2>
          {e.kind === "denied"
            ? "Administração restrita ao proprietário"
            : "Configurações indisponíveis"}
        </h2>
        <p>{e.message}</p>
        <p>
          Empresa atual:{" "}
          {
            access.organizations.find((o) => o.id === scope.organizationId)
              ?.name
          }
          . Loja atual: {access.active.name}.
        </p>
        <Link href="/onboarding">Cadastrar nova empresa</Link>
        <p>
          <Link href="/convites">Aceitar convite para outra empresa</Link>
        </p>
      </section>
    );
  }
  return (
    <SettingsWorkspace
      key={access.user.id + scope.organizationId + scope.storeId}
      data={data}
      scope={scope}
      userId={access.user.id}
    />
  );
}
