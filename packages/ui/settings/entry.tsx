"use client";
import Link from "next/link";
import type { FormEvent } from "react";
import { useSettingsMutation } from "./mutation";
import { SettingsNotice } from "./workspace";
import styles from "./settings.module.css";
export function SettingsEntry({
  kind,
  userId,
}: {
  kind: "onboard" | "accept";
  userId: string;
}) {
  const m = useSettingsMutation(userId, kind, "/app/configuracoes");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload =
      kind === "onboard"
        ? {
            name: f.get("name"),
            storeName: f.get("storeName"),
            displayName: f.get("displayName"),
          }
        : { code: f.get("code"), displayName: f.get("displayName") };
    m.send({ kind, payload, key: crypto.randomUUID() });
  }
  return (
    <main className={styles.entry}>
      <h1>{kind === "onboard" ? "Cadastrar empresa" : "Aceitar convite"}</h1>
      <p>
        Ambiente fictício. Use uma conta com email confirmado.{" "}
        {kind === "onboard"
          ? "Uma nova empresa será criada com você como proprietário e acesso explícito à primeira loja."
          : "O convite vale somente para o email confirmado do destinatário."}
      </p>
      <SettingsNotice mutation={m} />
      <form onSubmit={submit} className={styles.card}>
        <fieldset disabled={m.disabled} className={styles.root}>
          <label>
            Seu nome de exibição
            <input
              name="displayName"
              required
              maxLength={120}
              autoComplete="name"
            />
          </label>
          {kind === "onboard" ? (
            <>
              <label>
                Nome da empresa
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Nome da primeira loja
                <input name="storeName" required maxLength={120} />
              </label>
            </>
          ) : (
            <label>
              Código do convite
              <input
                name="code"
                required
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
          <button>
            {kind === "onboard"
              ? "Criar empresa e primeira loja"
              : "Confirmar aceite"}
          </button>
        </fieldset>
      </form>
      <div className={styles.links}>
        <Link href="/app/visao-geral">Voltar à operação</Link>
        <Link href={kind === "onboard" ? "/convites" : "/onboarding"}>
          {kind === "onboard" ? "Tenho um convite" : "Cadastrar nova empresa"}
        </Link>
      </div>
    </main>
  );
}
