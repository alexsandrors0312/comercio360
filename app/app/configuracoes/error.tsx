"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1>Configurações indisponíveis</h1>
      <p>
        Tente consultar novamente. Confira tentativas pendentes antes de repetir
        alterações.
      </p>
      <button onClick={reset}>Tentar novamente</button>
    </section>
  );
}
