"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center-state" role="alert">
      <h1>Não foi possível carregar</h1>
      <p>Tente novamente em alguns instantes.</p>
      <button className="primary" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
