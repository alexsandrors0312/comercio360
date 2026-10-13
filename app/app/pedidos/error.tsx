"use client";

export default function OrdersError({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1>Pedidos indisponíveis</h1>
      <p>Não foi possível carregar os pedidos desta loja.</p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
