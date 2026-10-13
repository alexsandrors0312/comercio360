import "server-only";
import { createClient, isConfigured } from "../supabase/server";
import {
  settingsCommandSchema,
  settingsDataSchema,
  settingsResultSchema,
  settingsContextResultSchema,
  settingsScopeSchema,
} from "../../packages/validation/settings";
import type {
  SettingsActionResult,
  SettingsData,
  SettingsScope,
} from "../../packages/domain/settings-contracts";
export class SettingsError extends Error {
  constructor(
    public readonly kind: "invalid" | "denied" | "conflict" | "unknown",
  ) {
    super(
      kind === "invalid"
        ? "Confira os campos informados e os limites do cadastro."
        : kind === "denied"
          ? "Acesso não permitido ou convite indisponível. Confira sua conta e o responsável."
          : kind === "conflict"
            ? "O registro mudou ou já existe. Atualize os dados antes de tentar novamente."
            : "Não foi possível confirmar o resultado. Reenvie a mesma tentativa para conferir.",
    );
  }
}
function classify(error: { code?: string }) {
  return new SettingsError(
    error.code === "42501"
      ? "denied"
      : ["PT409", "23505"].includes(error.code ?? "")
        ? "conflict"
        : error.code === "22023"
          ? "invalid"
          : "unknown",
  );
}
async function clientForIdentity() {
  if (!isConfigured()) throw new SettingsError("unknown");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new SettingsError("denied");
  return { client, user: auth.data.user };
}
export async function readSettings(
  scope: SettingsScope,
): Promise<SettingsData> {
  const parsed = settingsScopeSchema.safeParse(scope);
  if (!parsed.success) throw new SettingsError("invalid");
  try {
    const { client } = await clientForIdentity();
    const { data, error } = await client.rpc("settings_read", {
      p_org: parsed.data.organizationId,
      p_store: parsed.data.storeId,
    });
    if (error) throw classify(error);
    return settingsDataSchema.parse(data);
  } catch (e) {
    throw e instanceof SettingsError ? e : new SettingsError("unknown");
  }
}
export async function executeSettings(
  input: unknown,
): Promise<SettingsActionResult> {
  const parsed = settingsCommandSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", message: new SettingsError("invalid").message };
  try {
    const { client } = await clientForIdentity();
    const command = parsed.data;
    const rpc =
      command.kind === "manage"
        ? "settings_mutate"
        : command.kind === "onboard"
          ? "settings_onboard"
          : "settings_accept";
    const args =
      command.kind === "manage"
        ? {
            p_org: command.scope.organizationId,
            p_store: command.scope.storeId,
            p_operation: command.mutation.operation,
            p_payload: command.mutation.payload,
            p_key: command.key,
          }
        : command.kind === "onboard"
          ? {
              p_name: command.payload.name,
              p_store_name: command.payload.storeName,
              p_display_name: command.payload.displayName,
              p_key: command.key,
            }
          : {
              p_code: command.payload.code,
              p_display_name: command.payload.displayName,
              p_key: command.key,
            };
    const { data, error } = await client.rpc(rpc, args);
    if (error) throw classify(error);
    return {
      status: "success",
      result: (command.kind === "manage"
        ? settingsResultSchema
        : settingsContextResultSchema
      ).parse(data),
    };
  } catch (e) {
    const error = e instanceof SettingsError ? e : new SettingsError("unknown");
    return { status: error.kind, message: error.message };
  }
}
export async function signUpAccount(
  input: unknown,
): Promise<{ message: string }> {
  const { signupSchema } = await import("../../packages/validation/settings");
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success)
    return { message: "Informe email válido e senha de 12 a 128 caracteres." };
  if (!isConfigured())
    return { message: "Cadastro indisponível neste ambiente." };
  try {
    const client = await createClient();
    const { error } = await client.auth.signUp(parsed.data);
    return {
      message: error
        ? "Não foi possível concluir o cadastro. Confira seus dados ou tente entrar."
        : "Solicitação recebida. Confirme seu email, se solicitado pelo provedor, e entre com sua senha. O cadastro não libera acesso às empresas.",
    };
  } catch {
    return { message: "Cadastro indisponível. Tente novamente." };
  }
}
