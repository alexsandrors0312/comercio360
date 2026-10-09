# ADR-0011 — Estoque por loja e histórico transacional

Data: 09/10/2026. Estado: adotada para implementação local, conforme autorização do responsável para avançar nas abas operacionais, com primeiro recorte documentado no [Pacote 003](../PACOTE_003_ESTOQUE.md).

O Estoque usa a variante do Catálogo e a loja como unidade de saldo. Movimentações manuais inteiras, justificadas e imutáveis atualizam saldo e auditoria atomicamente por RPC. Revisão esperada e idempotência protegem concorrência/reenvio; saldo negativo é recusado. Acesso requer vínculo e concessão explícita da loja, inclusive para proprietário/gerente. O ator é derivado da sessão; cliente não escolhe identidade nem usa segredo administrativo.

Migração incremental, RLS e FKs compostas mantêm a raiz de tenant em organizations.id. Não há aplicação remota nesta decisão. Compras, fornecedores, PDV, reservas, transferências e valoração terão recortes próprios; não são implicitamente implementados por um saldo manual. O ensaio de retry de limpeza fica pendente por instrução do responsável, sem reclassificar as duas tentativas inconclusivas ou liberar dados reais.
