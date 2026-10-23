"use client";
export default function DeliveriesError({ reset }: { reset: () => void }) {
  return <section role="alert"><h1>Entregas indisponíveis</h1><p>Não foi possível carregar os acompanhamentos.</p><button onClick={reset}>Tentar novamente</button></section>;
}
