"use client";

import styles from "./catalog.module.css";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className={styles.state} role="alert">
      <h1>Produtos</h1>
      <h2>Não foi possível carregar o catálogo</h2>
      <p>Tente novamente. Se o problema continuar, procure o suporte.</p>
      <button type="button" className={styles.secondary} onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
