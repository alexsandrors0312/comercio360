"use server";
import { executeSettings, signUpAccount } from "@/lib/settings/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
export async function settingsAction(input: unknown) {
  const result = await executeSettings(input);
  if (
    result.status === "success" &&
    result.result.organizationId &&
    result.result.storeId
  ) {
    try {
      const client = await createClient();
      const { error } = await client.rpc("set_active_store", {
        p_organization_id: result.result.organizationId,
        p_store_id: result.result.storeId,
      });
      if (error)
        return {
          status: "unknown" as const,
          message:
            "Cadastro registrado, mas a seleção não foi confirmada. Reenvie a mesma tentativa.",
        };
      const jar = await cookies();
      const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      };
      jar.set("c360-org", result.result.organizationId, options);
      jar.set("c360-store", result.result.storeId, options);
    } catch {
      return {
        status: "unknown" as const,
        message:
          "Não foi possível confirmar a seleção. Reenvie a mesma tentativa.",
      };
    }
  }
  return result;
}
export async function signupAction(
  _previous: { message: string },
  form: FormData,
) {
  return signUpAccount({
    email: form.get("email"),
    password: form.get("password"),
  });
}
