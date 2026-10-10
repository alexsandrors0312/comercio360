"use client";

export default function CustomersError({ retry }: { retry: () => void }) {
  return (
    <section role="alert">
      <h1>Clientes indisponíveis</h1>
      <p>Não foi possível carregar o cadastro desta empresa.</p>
      <button type="button" onClick={retry}>
        Tentar novamente
      </button>
    </section>
  );
}
