"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="construction" role="alert">
      <h1>Compras / Fornecedores</h1>
      <p>Não foi possível carregar as compras. Tente novamente.</p>
      <button onClick={reset}>Tentar novamente</button>
    </section>
  );
}
