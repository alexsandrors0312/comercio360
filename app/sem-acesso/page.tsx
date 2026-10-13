import { logout } from "../actions";
import Link from "next/link";
export default function NoAccess() {
  return (
    <main className="center-state">
      <h1>Acesso ainda não liberado</h1>
      <p>
        Seu usuário precisa de um vínculo ativo com uma empresa e de acesso a
        pelo menos uma loja ativa. Ter vínculo com a empresa não libera acesso
        às lojas. Solicite a liberação ao responsável.
      </p>
      <p><Link href="/onboarding">Cadastrar empresa</Link></p>
      <p><Link href="/convites">Aceitar convite manual</Link></p>
      <form action={logout}>
        <button className="primary">Voltar ao login</button>
      </form>
    </main>
  );
}
