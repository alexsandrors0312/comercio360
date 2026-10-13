"use client";

export default function ReportError({ reset }: { reset: () => void }) {
  return <section role="alert"><h1>Relatórios indisponíveis</h1><p>Não foi possível carregar a consulta.</p>
    <button type="button" onClick={reset}>Tentar novamente</button></section>;
}
