# Compras 004 e homologação das operações — 09/10/2026

O responsável autorizou a próxima implementação operacional, a homologação das migrações e a publicação no ambiente dev existente. Compras/Fornecedores integra agora o Estoque. Somente dados fictícios; o ensaio de limpeza continua adiado.

## Comportamento entregue

`/app/compras` cadastra fornecedores por organização e pedidos por loja, com até 50 linhas, custos BRL em centavos e snapshots. Criar não movimenta estoque. Receber integralmente gera uma entrada por SKU, atualiza o pedido e audita tudo na mesma transação; falha em uma linha desfaz tudo. Cancelar pedido aberto exige motivo e não altera saldo. Fornecedor inativo permite receber pedido já aberto; produto/variante inativos impedem recebimento.

Proprietário/gerente/comprador gerenciam fornecedor e pedido; proprietário/gerente/estoquista recebem. Caixa não acessa custos. Sessão, vínculo e loja são reautorizados em página/action/RPC, inclusive replay. Revisão esperada e UUID com payload normalizado impedem sobrescrita/duplicação. Resposta perdida conserva a tentativa. Rascunho de fornecedor mantém sua revisão original durante refresh externo.

[Contrato 004](PACOTE_004_COMPRAS.md), [ADR-0012](adr/ADR-0012-compras.md), [revisão R1](evidencias/compras-004-review-2026-10-09.json), [revisão instrumental R2](evidencias/compras-004-review-2026-10-09-r2.json) e [procedimento hospedado](guias/OPERACOES_HOMOLOGACAO.md). A [entrega local original do Estoque](ENTREGA_ESTOQUE_003_2026-10-09.md) mantém seus resultados históricos.

Fora do recorte: recebimento parcial, devolução, contas a pagar, pagamentos, fiscal, custo médio, transferências e PDV. O painel geral ainda mostra indicadores fictícios.

## Validação local e ajuste de carregamento

A primeira integração passou com 318/318 Vitest e 35/35 E2E, tipos/build PASS e lint zero erros/um aviso histórico. Diagnóstico posterior chegou a 320/320; com o ajuste de carregamento, a suíte atual passou **323/323 Vitest** em 28 arquivos. Revisão independente reproduziu SQL 34/34; na retomada, SSR/instrumento 22/22. PGlite local usa uma sessão, e Auth do E2E local é simulado.

O novo hook `useHydrated` mantém campos e botões das operações desabilitados no HTML inicial. Após a hidratação, o fluxo libera normalmente; CAS, payload e UUID de tentativas ambíguas permanecem intactos. Filtros GET intencionais continuam habilitados. A regressão retém scripts externos, permite o streaming inline do Next e verifica bloqueio seguido de habilitação em Compras e Estoque. Teste direcionado **1/1 PASS**; suíte completa do navegador e revisão final em conclusão nesta atualização.

Falhas preservadas: JSX dentro de try/catch no primeiro lint; diretiva TypeScript desnecessária no teste do instrumento; regex inicial de atributos HTML nos testes SSR. Foram corrigidas antes dos gates correspondentes. Na retomada, a primeira regressão com JavaScript totalmente desligado expirou porque o conteúdo transmitido pelo Next depende de scripts inline; o teste foi corrigido para atrasar somente os scripts externos. A primeira tentativa seguinte registrou URL de estoque antes de concluir a navegação; sincronização corrigida. Typecheck executado durante o dev E2E leu arquivo de tipos em geração; deve ser repetido após encerrar esse servidor, sem considerar aquela tentativa PASS.

## Migrações e primeira publicação

Às 17h43 BRT foram aplicadas somente `202610090001_inventory.sql` e `202610090002_procurement.sql` em `comercio360-dev`: sete → nove versões. Antes/depois: 385 eventos de auditoria, quatro usuários Auth e zero imagens/objetos/capas. Conteúdo de auditoria, identidades/senhas/concessões e HMAC comparados em memória e preservados; bucket privado. [Evidência](evidencias/operacoes-003-004-migrations-2026-10-09T20-43-02-618Z.json).

O primeiro preflight falhou por consulta de coluna inexistente de capa, antes de qualquer escrita; corrigido para `product_images`. [FAIL original](evidencias/operacoes-003-004-migrations-2026-10-09T20-42-00-278Z.json). Não houve seed, reset, repair ou edição de migração aplicada.

Código `2c11de0dbd0598f7a6feeb3bc0dfdba1d3ba70cc`, build Linux `3c0ce214-53e1-45de-824e-0608aa78ba01` concluído com sucesso. Versão web `ee6dc2f6-3182-4f67-9e6c-068c1dbfc670` ativa em 100% às 17h45 BRT. [Metadados](evidencias/operacoes-003-004-publication-2026-10-09.json). O Worker de limpeza e seus segredos não foram publicados/alterados.

## Ensaios Supabase/HTTPS preservados

| Execução UTC | Resultado | Encerramento |
| --- | --- | --- |
| [20h46](evidencias/operacoes-004-hosted-2026-10-09T20-46-48-066Z.json) | FAIL na fase de fornecedor | Compensação/arquivamento e postflight PASS; quatro eventos fictícios adicionados |
| [20h52](evidencias/operacoes-004-hosted-2026-10-09T20-52-57-253Z.json) | FAIL no envio do fornecedor; página/loja/preenchimento PASS | Compensação/arquivamento e postflight PASS; +4 eventos |
| [20h57](evidencias/operacoes-004-hosted-2026-10-09T20-57-49-246Z.json) | FAIL no envio; nenhum POST observado/aviso capturado | Compensação/arquivamento e postflight PASS; +4 eventos |
| [21h00](evidencias/operacoes-004-hosted-2026-10-09T21-00-08-881Z.json) | **PASS nas 15 fases**, oito subetapas de fornecedor e POST 200 | Compensação/arquivamento e postflight PASS; +32 eventos |

O ensaio aprovado percorreu fornecedor → pedido de duas linhas → recebimento → Estoque no Worker real. REST verificou replay, payload alterado com HTTP409/PT409, dois recebimentos paralelos com chaves diferentes (um sucesso/um conflito), mesma chave (mesmo resultado), uma entrada por SKU e uma auditoria de recebimento por pedido. Loja alheia e caixa foram negados; interface de caixa não mostrou compras operacionais. São requisições REST reais, sem medição de PIDs de backend ou promessa de todos os interleavings PostgreSQL.

A causa exata das três falhas iniciais não foi comprovada. O envio anterior à hidratação é um risco verificável dos formulários originais e motivou o ajuste; não atribuir retroativamente todas as falhas a ele. Uma chamada diagnóstica da função de fornecedor no PostgreSQL real passou em transação com rollback, sem cadastro durável.

Fixtures usam `FICTICIO HOMOLOG004` e UUID. Estoque próprio foi compensado até zero; fornecedor/produto inativados e pedidos encerrados. Pedidos, movimentos e auditoria fictícios permanecem identificados e imutáveis, sem apagar história. Postflight comparou o conteúdo exato dos eventos anteriores e preservou identidades, senhas, permissões, HMAC, bucket privado e imagens. Captura diagnóstica, quando houver, é local/ignorada pelo Git; não publicar screenshots com dados de sessão/empresa.

## Fechamento e próximo passo

A validação e republicação do ajuste de carregamento estão em andamento. Registrar revisão R3, versão final, teste HTTPS posterior e evidência consolidada antes de declarar esse delta publicado.

Próximo pacote recomendado: **005 — Venda básica/PDV**, com contrato/ADR próprios e baixa atômica de estoque. [Perspectiva](PERSPECTIVA_DESENVOLVIMENTO_2026-10-09.md): aproximadamente **35% estimados**, faixa 30–40%; PDV e clientes com homologação integrada aproximam **45–50%**. Não é medição de horas ou prontidão de produção, e ainda não há data responsável para 50%.

Retry de limpeza de 06/10 continua inconclusivo/`not_run`, sem nova janela. Recuperação completa, produção isolada e definição da loja piloto permanecem pendentes para dados reais.
