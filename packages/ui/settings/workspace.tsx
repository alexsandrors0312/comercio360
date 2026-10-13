"use client";
import Link from "next/link";
import type { FormEvent } from "react";
import {
  SETTINGS_ROLES,
  SETTINGS_ROLE_LABELS,
  type SettingsData,
  type SettingsScope,
} from "../../domain/settings-contracts";
import { useSettingsMutation } from "./mutation";
import styles from "./settings.module.css";
type Mutation = ReturnType<typeof useSettingsMutation>;
export function SettingsNotice({ mutation: m }: { mutation: Mutation }) {
  return (
    <section
      aria-label="Resultado da alteração"
      aria-live="polite"
      className={styles.notice}
    >
      {m.storageError && (
        <p role="alert">
          Armazenamento da aba indisponível. Escritas bloqueadas para preservar
          reenvio seguro.
        </p>
      )}
      {m.message && <p role="status">{m.message}</p>}
      {m.attempt && (
        <>
          <p>
            Há uma tentativa não confirmada nesta aba. Não altere os dados antes
            de conferir.
          </p>
          <button
            disabled={m.pending || !m.ready || m.storageError}
            onClick={() => m.send(m.attempt, true)}
          >
            Reenviar mesma tentativa
          </button>
          <button disabled={m.pending} onClick={m.discard}>
            Descartar tentativa local
          </button>
        </>
      )}
      {m.code && (
        <div>
          <p>
            Código do convite — compartilhe manualmente com o destinatário. Não
            será enviado automaticamente.
          </p>
          <output aria-label="Código do convite" className={styles.code}>
            {m.code}
          </output>
          <button onClick={m.clearCode}>Ocultar código</button>
        </div>
      )}
    </section>
  );
}
function RoleSelect({ value = "cashier" }: { value?: string }) {
  return (
    <label>
      Papel
      <select name="role" aria-label="Papel" defaultValue={value}>
        {SETTINGS_ROLES.map((r) => (
          <option key={r} value={r}>
            {SETTINGS_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}
function StoreChecks({
  data,
  selected = [],
}: {
  data: SettingsData;
  selected?: string[];
}) {
  return (
    <fieldset className={styles.stores}>
      <legend>Lojas concedidas</legend>
      {data.stores
        .filter((s) => s.active)
        .map((s) => (
          <label key={s.id}>
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={selected.includes(s.id)}
            />
            {s.name}
          </label>
        ))}
    </fieldset>
  );
}
export function SettingsWorkspace({
  data,
  scope,
  userId,
}: {
  data: SettingsData;
  scope: SettingsScope;
  userId: string;
}) {
  const m = useSettingsMutation(
    userId,
    scope.organizationId + ":" + scope.storeId,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const operation = String(form.get("operation"));
    const name = String(form.get("name") ?? "");
    const id = String(form.get("id") ?? "");
    const revision = String(form.get("revision") ?? "");
    const payload =
      operation === "rename_organization"
        ? { name, revision }
        : operation === "create_store"
          ? { name }
          : operation === "update_store"
            ? { id, name, revision, active: form.get("active") === "on" }
            : operation === "update_member"
              ? {
                  id,
                  revision,
                  role: form.get("role"),
                  active: form.get("active") === "on",
                  storeIds: form.getAll("storeIds"),
                }
              : operation === "invite"
                ? {
                    email: form.get("email"),
                    role: form.get("role"),
                    storeIds: form.getAll("storeIds"),
                    code: crypto.randomUUID(),
                  }
                : { id, revision };
    m.send({
      kind: "manage",
      scope,
      key: crypto.randomUUID(),
      mutation: { operation, payload },
    });
  }
  return (
    <div className={styles.workspace}>
      <header>
        <p className="eyebrow">ADMINISTRAÇÃO · {data.organization.name}</p>
        <h1>Configurações</h1>
        <p>
          Dados fictícios. Gerencie a empresa, lojas e acessos. Revogar acesso
          não apaga o histórico.
        </p>
        <div className={styles.links}>
          <Link href="/onboarding">Cadastrar outra empresa</Link>
          <Link href="/convites">Aceitar convite</Link>
        </div>
      </header>
      <SettingsNotice mutation={m} />
      <fieldset disabled={m.disabled} className={styles.root}>
        <section className={styles.card}>
          <h2>Empresa</h2>
          <form onSubmit={submit} key={"org" + data.organization.revision}>
            <input type="hidden" name="operation" value="rename_organization" />
            <input
              type="hidden"
              name="revision"
              value={data.organization.revision}
            />
            <label>
              Nome da empresa
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={data.organization.name}
              />
            </label>
            <button>Salvar empresa</button>
          </form>
        </section>
        <section className={styles.card}>
          <h2>Lojas</h2>
          <form onSubmit={submit} aria-label="Cadastrar loja">
            <input type="hidden" name="operation" value="create_store" />
            <label>
              Nome da nova loja
              <input name="name" required maxLength={120} />
            </label>
            <button>Cadastrar loja</button>
          </form>
          <ul className={styles.list}>
            {data.stores.map((s) => (
              <li key={s.id}>
                <form
                  aria-label={"Editar loja " + s.name}
                  onSubmit={submit}
                  key={s.revision}
                >
                  <input type="hidden" name="operation" value="update_store" />
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="revision" value={s.revision} />
                  <label>
                    Nome da loja
                    <input
                      name="name"
                      defaultValue={s.name}
                      required
                      maxLength={120}
                    />
                  </label>
                  <label className={styles.check}>
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={s.active}
                    />
                    Loja ativa
                  </label>
                  <button>Salvar loja</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.card}>
          <h2>Usuários da empresa</h2>
          <p>
            Somente outros vínculos podem ser alterados aqui. Um proprietário
            ativo deve conservar acesso a uma loja ativa.
          </p>
          <ul className={styles.list}>
            {data.members.map((member) => (
              <li key={member.id}>
                <h3>
                  {member.name || "Usuário"} ·{" "}
                  {SETTINGS_ROLE_LABELS[member.role]}
                </h3>
                <p className={styles.code}>Identidade {member.userId}</p>
                {member.userId === userId ? (
                  <p>Seu vínculo · {member.active ? "Ativo" : "Inativo"}</p>
                ) : (
                  <form
                    aria-label={
                      "Editar usuário " + (member.name || member.userId)
                    }
                    onSubmit={submit}
                    key={member.revision}
                  >
                    <input
                      type="hidden"
                      name="operation"
                      value="update_member"
                    />
                    <input type="hidden" name="id" value={member.id} />
                    <input
                      type="hidden"
                      name="revision"
                      value={member.revision}
                    />
                    <RoleSelect value={member.role} />
                    <label className={styles.check}>
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={member.active}
                      />
                      Vínculo ativo
                    </label>
                    <StoreChecks data={data} selected={member.storeIds} />
                    <button>Salvar acesso</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.card}>
          <h2>Convidar usuário</h2>
          <p>
            O destinatário precisa entrar com o email confirmado informado.
            Convite válido por sete dias; lojas e papel são definidos abaixo.
          </p>
          <form aria-label="Criar convite" onSubmit={submit}>
            <input type="hidden" name="operation" value="invite" />
            <label>
              Email do convidado
              <input
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="off"
              />
            </label>
            <RoleSelect />
            <StoreChecks data={data} />
            <button>Gerar convite manual</button>
          </form>
        </section>
        <section className={styles.card}>
          <h2>Convites recentes</h2>
          <p>
            Até100 convites mais recentes. Vencimento e revogação impedem
            aceite.
          </p>
          <ul className={styles.list}>
            {data.invitations.map((i) => (
              <li key={i.id}>
                <p>
                  {i.email} · {SETTINGS_ROLE_LABELS[i.role]} ·{" "}
                  {i.status === "accepted"
                    ? "Aceito"
                    : i.status === "revoked"
                      ? "Revogado"
                      : "Pendente"}
                </p>
                <p>
                  Validade:{" "}
                  {new Date(i.expiresAt).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </p>
                {i.status === "pending" && (
                  <form onSubmit={submit}>
                    <input
                      type="hidden"
                      name="operation"
                      value="revoke_invite"
                    />
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="revision" value={i.revision} />
                    <button>Revogar convite para {i.email}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {data.invitations.length === 0 && <p>Nenhum convite cadastrado.</p>}
        </section>
      </fieldset>
    </div>
  );
}
