"use client";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <section className="construction" role="alert">
      <h1>PDV / Vendas</h1>
      <p>
        Não foi possível carregar o PDV. Tente novamente; qualquer envio
        anterior permanece preservado nesta aba.
      </p>
      <button onClick={retry}>Tentar novamente</button>
    </section>
  );
}
