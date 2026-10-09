"use client";
export default function InventoryError({ reset }: { reset: () => void }) {
  return (
    <section role="alert">
      <h1>Estoque indisponível</h1>
      <p>Não foi possível carregar os dados desta loja.</p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
