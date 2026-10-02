import styles from "./catalog.module.css";

export default function Loading() {
  return (
    <section
      className={styles.state}
      aria-busy="true"
      aria-label="Carregando catálogo"
    >
      <h1>Produtos</h1>
      <p>Carregando catálogo da empresa e preços da loja selecionada…</p>
    </section>
  );
}
