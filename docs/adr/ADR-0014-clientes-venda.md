# ADR-0014 — Cadastro mínimo e associação atômica à venda

10/10/2026. Adotada para o [Pacote 006](../PACOTE_006_CLIENTES.md), autorizado pelo responsável após a entrega do PDV005 em dev fictício.

Clientes pertencem à organização e são encontrados em qualquer loja a que o operador esteja autorizado. Acesso ao cadastro exige vínculo atual, papel proprietário/gerente/caixa e concessão da loja selecionada. Caixa cria/consulta para atender no balcão; proprietário/gerente alteram estado e dados com CAS. Não há exclusão física, mesclagem automática ou comunicação. Nome obrigatório e contato opcional minimizam o cadastro; dados reais exigem decisões posteriores de retenção, consentimento e atendimento ao titular.

Vendas guardam cliente opcional e snapshot do nome. A confirmação com cliente é atômica com preço/saldo/movimentos/auditoria. FK composta impede associação entre organizações; venda sem cliente e venda histórica permanecem válidas. A confirmação bloqueia cliente ativo antes de catálogo/estoque, mas consulta primeiro o ledger da tentativa após reautorizar, preservando replay depois de uma inativação. Cancelamento conserva o snapshot.

A incremental 006 acrescenta uma RPC de venda com nome distinto e helper privado compartilhado, mantendo `sales_confirm` antiga, assinatura/retorno de `sales_list` e payload `{items}` para vendas sem cliente. Evita overload com parâmetros padrão e não reescreve migração aplicada. Cadastro também usa ledger privado, revisão esperada, RLS, grants mínimos, auditoria transacional e gatilhos de imutabilidade estrutural. Histórico de vendas do cliente é limitado à loja autorizada selecionada.

Gates locais e revisão independente precedem escrita remota; Supabase/HTTPS dev produzem evidência separada. Teste local PGlite não comprova toda concorrência PostgreSQL. Dados reais, produção, política de retenção e ensaio de limpeza ficam fora da autorização.
