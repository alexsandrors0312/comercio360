import Link from "next/link";
import { isConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./form";
export const dynamic = "force-dynamic";
export default function Login() {
  const configured = isConfigured();
  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand">
          comércio<span>360</span>
        </div>
        <div>
          <p className="eyebrow">SEU COMÉRCIO, POR INTEIRO</p>
          <h1>
            Uma visão clara.
            <br />
            Um dia mais simples.
          </h1>
          <p>Acompanhe sua loja e encontre o que precisa da sua atenção.</p>
        </div>
        <small>Fundação do produto · v0.1</small>
      </section>
      <section className="auth-card">
        <p className="eyebrow">BEM-VINDO DE VOLTA</p>
        <h2>Entre na sua operação</h2>
        <p>Use o acesso vinculado à sua empresa.</p>
        {!configured && (
          <div className="notice">
            Ambiente em preparação. O acesso será liberado após a configuração
            do Supabase.
          </div>
        )}
        <LoginForm configured={configured} />
        {process.env.DEMO_ENABLED !== "false" && (
          <Link className="demo-link" href="/demo">
            Explorar demonstração com dados fictícios →
          </Link>
        )}
      </section>
    </main>
  );
}
