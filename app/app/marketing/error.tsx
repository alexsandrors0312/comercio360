"use client";
export default function MarketingError({ reset }: { reset: () => void }) {
  return <section role="alert"><h1>Marketing indisponível</h1><p>Não foi possível carregar campanhas.</p><button onClick={reset}>Tentar novamente</button></section>;
}
