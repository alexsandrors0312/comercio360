"use client";
import { useActionState } from "react";
import { login } from "../actions";
export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(login, { error: "" });
  return (
    <form action={action} className="login-form">
      <label>
        E-mail
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="voce@empresa.com.br"
        />
      </label>
      <label>
        Senha
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.error && (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      )}
      <button className="primary" disabled={pending || !configured}>
        {pending ? "Entrando…" : "Entrar na minha loja"}
      </button>
    </form>
  );
}
