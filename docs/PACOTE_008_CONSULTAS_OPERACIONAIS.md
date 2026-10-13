# Pacote008 — Visão Geral e Relatórios operacionais

12/10/2026. Recorte de continuidade da autorização para desenvolver o SaaS com dados fictícios e concluir abas, conforme [plano](PLANO_SAAS_PILOTO_2026-10-12.md). [ADR-0016](adr/ADR-0016-consultas-operacionais.md). Base `acc6207` mais trabalho local preservado; depende dos contratos 003/005/007. Não autoriza escrita remota ou dados reais.

## Fluxo e dados

`/app/visao-geral` passa a consultar a loja ativa autorizada, substituindo somente nessa rota os indicadores do mock. Mostra número de vendas confirmadas (todo o histórico), pedidos abertos e SKUs consultáveis; últimas cinco vendas confirmadas e links para módulos. Cada contagem vem do `total_count` retornado pela RPC correspondente, não da soma de uma página. Não mostra receita recebida, lucro/margem, período diário ou estoque valorizado. A tela informa ambiente fictício, escopo e que as leituras podem observar instantes diferentes; uma consulta falha é indisponível, nunca zero inventado. A prévia `/demo` mantém o painel demonstrativo.

`/app/relatorios` oferece duas consultas: vendas (`all`/`confirmed`/`cancelled`) e estoque (busca produto/SKU). Página de20 linhas, navegação preservando tipo/filtro; todo o histórico da loja, sem exportação, comparação entre lojas ou contatos de clientes. Vendas mostram ID, estado, total registrado e data com link ao PDV; estoque mostra produto/SKU, ativo e unidades com link ao detalhe. Quantidade de registros e totais por venda não representam pagamento.

## Autorização e fronteiras

Proprietário/gerente/caixa consultam vendas/pedidos e estoque; comprador/estoquista consultam estoque, sem acesso aos relatórios de vendas. Sessão, vínculo/papel e loja são reautorizados pelas DAL/RPCs existentes em cada leitura. O papel do contexto serve somente para escolher a apresentação, nunca substitui o leitor autorizado. Resultados de erro/negado têm mensagens sanitizadas; nada de chave administrativa, novos grants, DML ou caches compartilhados. Sem dados de Compras/custos ou contatos no DTO de relatório.

Reutilizar `listSales`, `listOrders` e `listInventoryStock`, mantendo limites e RLS existentes. Não criar tabela, métrica financeira ou migração para este recorte. Leituras paralelas não são snapshot transacional agregado; informar essa limitação. Parâmetros GET só incluem tipo, estado, SKU/produto e página, sem telefone/e-mail/nome de cliente.

## Critérios

Contagem independente do tamanho da página; erro sem número falso; papel sem permissão não consulta vendas; consultas cruzadas continuam recusadas pela DAL; paginação/filtros preservados; tela sem mocks na rota autenticada e demo preservada. Provas locais de composição, parâmetros e erro, E2E com operações fictícias/papéis/troca de loja e telas360/768/1440. Gates locais lint/tipos/Vitest/build/E2E e revisão independente. Migração/publicação/HTTPS deste pacote continuam `not_run` até ciclo próprio.
