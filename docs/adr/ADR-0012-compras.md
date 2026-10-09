# ADR-0012 — Compras e recebimento integral

09/10/2026. Adotada conforme autorização do responsável para próximas operações e homologação/publicação dev. [Contrato004](../PACOTE_004_COMPRAS.md).

Fornecedores pertencem à organização; pedidos pertencem à loja e guardam snapshots. Custos são centavos inteiros calculados no banco. Pedido aberto é recebido integralmente ou cancelado; recebimento chama o mecanismo transacional de Estoque e grava pedido/linhas/movimentos/auditoria atomicamente. CAS e idempotência protegem concorrência e respostas perdidas. Acesso de compras/custos é separado de caixa e da permissão para receber. Contas a pagar, fiscal, parcial e devoluções terão recortes próprios. Migrações incrementais003/004 e app serão homologados/publicados somente no dev existente; gates de produção e ensaio de limpeza seguem pendentes.
