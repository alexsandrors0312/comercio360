# Perspectiva de desenvolvimento — 09/10/2026

A etapa atual é a **fase 2, operação comercial básica**. Fundação e Catálogo já existiam; Estoque003 e Compras004 acrescentam saldo/movimentação por loja, fornecedores, pedidos de compra e recebimento integral que atualiza estoque e auditoria na mesma transação.

Estimativa de planejamento: **30–40% do escopo, aproximadamente35%**, considerando também os módulos futuros descritos na [base v0.3](architecture/BASE_v0.3.md). Não é medição de horas, cobertura de testes nem prontidão para produção. A estimativa histórica de aproximadamente20% em04/10 permanece válida como registro daquela avaliação.

| Marco seguinte | Resultado verificável |
| --- | --- |
| Venda básica/PDV | Carrinho por loja, preço vigente/snapshot, venda confirmada com baixa atômica de estoque, total em centavos, cancelamento/estorno controlado, autorização, idempotência e auditoria. Homologar a integração real antes de uso. |
| Clientes básico integrado | Cadastro por organização, busca, acesso autorizado e associação opcional à venda, sem comunicação automática. Regras de dados e descoberta do balcão definidas antes do contrato. |
| Integração e homologação | Percurso catálogo → compra → recebimento → venda → saldo, incluindo disputa pelo último item, falha/reenvio e isolamento de loja. Evidência Supabase/HTTPS e revisão independente. |

Com esses dois módulos e a homologação integrada, é razoável reavaliar para **45–50%**. O próximo pacote recomendado é **005 — Venda básica/PDV**, com contrato e ADR próprios. Pagamento integrado, fiscal, fretes e canais precisam de descoberta; não devem ser presumidos a partir do mock de apresentação.

Depois permanecem pedidos omnichannel, separação/logística, marketing, financeiro/conciliação, relatórios e automações/escala. Sem capacidade de equipe e descoberta do piloto fechadas, ainda não há uma data responsável para50%.

Publicação no ambiente de homologação usa dados fictícios. Retry de limpeza, recuperação completa, produção isolada e identificação da loja piloto continuam pendentes para dados reais. O ensaio de limpeza permanece adiado conforme instrução do responsável.
