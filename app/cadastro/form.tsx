"use client";
import { useActionState } from "react";
import { signupAction } from "@/app/actions/settings";
import { useHydrated } from "@/packages/ui/use-hydrated";
export function SignupForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(signupAction, {
    message: "",
  });
  const hydrated = useHydrated();
  return (
    <form action={action} className="login-form">
      <fieldset
        disabled={!configured || !hydrated || pending}
        style={{ border: 0, padding: 0, display: "grid", gap: 16 }}
      >
        <label>
          Email
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
          />
        </label>
        <label>
          Senha (12 a 128 caracteres)
          <input
            required
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
        </label>
        <button className="primary">Criar minha conta</button>
      </fieldset>
      {state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
