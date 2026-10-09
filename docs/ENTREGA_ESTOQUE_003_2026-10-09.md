# Estoque 003 — entrega local de 09/10/2026

O responsável pediu continuidade nas abas operacionais, deixando o ensaio remoto de limpeza pendente. Foi implementado o primeiro recorte, Estoque, conforme [contrato](PACOTE_003_ESTOQUE.md) e [ADR-0011](adr/ADR-0011-estoque.md). A Fundação e o Catálogo permanecem integrados; demais abas comerciais continuam em construção.

## Comportamento entregue

`/app/estoque` consulta saldos por loja e variante/SKU, pesquisa produtos e mostra histórico paginado. Entradas e saídas manuais exigem motivo; saldo negativo é recusado. Cadastros inativos preservam saldo/histórico e não recebem novas movimentações.

Proprietário, gerente e estoquista movimentam; caixa e comprador também consultam. Servidor e banco revalidam vínculo/papel e acesso explícito à loja. Organização/loja isolam saldos e histórico. Quantidade, revisão, motivo e UUID são validados; saldo, movimento imutável e auditoria integram a mesma transação.

Revisão esperada recusa formulário desatualizado. Mesma chave e payload devolvem a operação original; payload diferente gera conflito. Quando a resposta é perdida, os campos ficam preservados e bloqueados para edição; “Confirmar envio anterior” repete exatamente a tentativa para evitar duplicação.

## Evidências locais

| Verificação | Resultado |
| --- | --- |
| `npm.cmd test` | 23 arquivos, **226/226 PASS**, exit 0; 73 novos testes de Estoque |
| Novos testes | Domínio 21, UI SSR estática 7, aplicação 19, SQL 26 |
| `node node_modules/@playwright/test/cli.js test` | **24/24 PASS**, exit 0, 52,8 s; 17 regressões anteriores + 7 Estoque |
| `npm.cmd run typecheck` | PASS, exit 0 |
| `npm.cmd run lint` | exit 0; zero erros, um aviso histórico de export default anônimo no config U1 |
| `npm.cmd run build` | PASS, exit 0; rota dinâmica `/app/estoque` compilada |
| Revisão independente | Sem achados bloqueantes locais; SQL **26/26 PASS** reproduzido independentemente |
| Responsividade | Chromium 360/768/1440 sem overflow; capturas 360/1440 inspecionadas visualmente |
| RepoMap | Regenerado: 114 arquivos / 656 símbolos |

[Validação e hashes](evidencias/estoque-003-validation-2026-10-09.json), [revisão independente](evidencias/estoque-003-review-2026-10-09.json). Browser e SQL usam dados fictícios locais; PGlite executa as migrações reais e o harness simula Auth/HTTP. Os testes de UI SSR são estáticos; a interação/reenvio é comprovada separadamente no navegador.

Os sete cenários novos exercitam entrada/saída, insuficiência, histórico, busca, isolamento após troca confirmada de loja; caixa sem escrita; dois formulários com revisão antiga; perda deliberada da resposta **depois do commit**, com confirmação sem duplicar saldo/histórico; três larguras de tela. SQL comprova idempotência também na auditoria, oito papéis, revogações, isolamento, limites, rollback e imutabilidade.

## Tentativas e limites preservados

- A primeira execução dos sete E2E teve 5 PASS/2 FAIL: seletores genéricos de `alert` também encontravam o anunciador interno de rotas do Next.js. Seletores passaram a identificar o texto da mensagem.
- A primeira regressão completa teve 23 PASS/1 FAIL: o teste navegava antes de a troca de loja concluir a gravação do cookie/redirecionamento. Agora aguarda a loja confirmada na página, conforme o padrão dos testes anteriores. A execução final passou 24/24. Essas correções alteraram somente o teste.
- A primeira rodada SQL coletada teve 24 PASS/2 FAIL por contexto residual da loja no fixture administrativo; corrigido o fixture, 26/26 PASS e posteriormente suíte global/revisão independente PASS.
- Tentativas em sandbox Windows falharam antes de coletar testes (`require` no carregador Vite, cache temporário EPERM) ou de gerar tipos (SWC/canonicalização). Execuções locais autorizadas fora desse sandbox concluíram. Não houve troca de dependências ou relaxamento de autorização. Avisos de cor e cancelamento de streams do Next durante navegação foram observados; a execução final encerrou com exit 0.
- Concorrência entre conexões PostgreSQL, Supabase/PostgREST hospedado e publicação Cloudflare desta versão: **`not_run`**. Dois formulários desatualizados e locks inspecionados não substituem esse ensaio entre sessões reais.

Nenhum deploy, migração remota, seed, alteração de Auth/segredos ou novo ensaio de limpeza foi realizado. A migração incremental `supabase/migrations/202610090001_inventory.sql` requer homologação futura em dev antes da publicação do app. A homologação publicada anteriormente ainda não contém Estoque.

## Continuidade

Próximo recorte de programação: Compras/Fornecedores e recebimento integrado ao Estoque, com contrato/ADR, estados e autorização definidos antes da implementação. Transferências, reservas, valoração/custo, inventário físico, PDV, pagamentos e fiscal permanecem futuros.

O ensaio de falha/retry da limpeza fica pendente por instrução de 09/10. As duas tentativas de 06/10 continuam inconclusivas/`not_run`, com relatórios/journal/revisões originais preservados; [diagnóstico de 07/10](operacao/CATALOGO_CRON_PUBLICACAO_2026-10-05.md). Dados reais continuam sujeitos aos gates de retry, recuperação completa, produção separada e loja piloto.
