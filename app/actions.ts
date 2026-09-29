"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, isConfigured } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/tenancy";
import { loginSchema, contextSchema } from "@/packages/validation";
export async function login(_previous: { error: string }, form: FormData) {
  if (!isConfigured())
    return { error: "O ambiente ainda precisa ser conectado ao Supabase." };
  const input = loginSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Informe um e-mail válido e sua senha." };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error)
    return {
      error: "Não foi possível entrar. Confira seus dados e tente novamente.",
    };
  redirect("/app/visao-geral");
}
export async function logout() {
  if (isConfigured()) {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) throw new Error("Não foi possível sair. Tente novamente.");
  }
  const jar = await cookies();
  jar.delete("c360-org");
  jar.delete("c360-store");
  redirect("/login");
}
export async function changeContext(form: FormData) {
  const input = contextSchema.safeParse(Object.fromEntries(form));
  if (!input.success) throw new Error("Seleção de loja inválida.");
  const access = await requireAccess();
  const { error } = await access.supabase.rpc("set_active_store", {
    p_organization_id: input.data.organizationId,
    p_store_id: input.data.storeId,
  });
  if (error)
    throw new Error(
      "Você não tem acesso a essa loja, ou não foi possível registrar a troca.",
    );
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
  jar.set("c360-org", input.data.organizationId, options);
  jar.set("c360-store", input.data.storeId, options);
  redirect("/app/visao-geral");
}
