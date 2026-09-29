import { Construction as ConstructionIcon, CircleCheck } from "lucide-react";
export function Construction({ label }: { label: string }) {
  return (
    <section className="center-state">
      <span className="state-icon">
        <ConstructionIcon size={32} />
      </span>
      <p className="eyebrow">PRÓXIMAS ETAPAS</p>
      <h1>{label}</h1>
      <h2>Em construção</h2>
      <p>
        Este módulo será disponibilizado em uma próxima etapa do Comércio 360.
      </p>
    </section>
  );
}
export function Loading() {
  return (
    <section aria-busy="true" aria-label="Carregando visão geral">
      <h1>Carregando visão geral…</h1>
      <div className="metrics">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="skeleton" />
        ))}
      </div>
      <div className="skeleton tall" />
    </section>
  );
}
export function Empty() {
  return (
    <section className="center-state">
      <CircleCheck size={36} />
      <h2>Nenhum movimento neste período</h2>
      <p>Quando houver atividades na loja, elas aparecerão aqui.</p>
    </section>
  );
}
