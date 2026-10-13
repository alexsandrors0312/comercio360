import Link from "next/link";
import { isConfigured } from "@/lib/supabase/server";
import { SignupForm } from "./form";
export const dynamic = "force-dynamic";
export default function Signup() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Criar conta</h1>
        <p>
          Ambiente de desenvolvimento fictício. Sua conta não libera acesso a
          empresas automaticamente. Confirme seu email quando solicitado e entre
          para cadastrar uma empresa ou aceitar um convite.
        </p>
        <SignupForm configured={isConfigured()} />
        <Link href="/login">Já tenho conta — entrar</Link>
      </section>
    </main>
  );
}
