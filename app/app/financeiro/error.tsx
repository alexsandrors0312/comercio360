"use client";
export default function FinanceError({ reset }: { reset: () => void }) {
  return <section role="alert"><h1>Financeiro indisponível</h1><p>Não foi possível carregar os lançamentos.</p><button onClick={reset}>Tentar novamente</button></section>;
}
