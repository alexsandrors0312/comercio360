# H-04 — registro da avaliação comparativa

Atualizado em 29/09/2026. **Avaliação parcial:** os braços Codex de D1 e U1 foram executados e revisados; U1 ainda não passou o gate E2E. Nenhum par Codex × DSH foi concluído. Este relatório registra execuções reais e bloqueios sem converter preparação em resultado.

## Base e moldes descartáveis

Origem comum: commit `4a800961b3503f143fcf0e940271326e2096f439`. Cada braço usa um repositório Git independente, sem `.env.example`, cofre, dados reais ou histórico da origem. Os arquivos não alterados foram comparados byte a byte com os blobs do commit. Cada molde tem um defeito sintético intencional e um envelope 0.1 por braço, validados antes do despacho.

| Caso | Diretório descartável sob `C:\Users\Alexs\AppData\Local\Temp` | HEAD comum | Auditoria da origem | Ordem prevista |
| --- | --- | --- | --- | --- |
| D1 — domínio | `h04-d1-blob-285553c194204d5bb34b70a1b980b96f` | `bd3103814e8f381c4c47fb6acc620e3b61941b69` | 106 arquivos preservados idênticos; só `tenancy.ts` recebeu o defeito | Codex → DSH |
| S1 — SQL | `h04-s1-fixed-4826f7f7205845e2b080eb029d80ed5e` | `8cb9e84ff262980584f900b166ae16af05ab848b` | 107 arquivos preservados idênticos; migração sintética adicional | DSH → Codex |
| U1 — interface | `h04-u1-78223936cb97431ea3d9dc282179834e` | `32416419132f4aa59b93a8ae95839e097af25064` | 106 arquivos preservados idênticos; só `shell.tsx` recebeu o defeito | Codex → DSH |

As primeiras cópias D1, S1 e U1 foram substituídas: `git archive` sob a configuração Windows converteu finais de linha de quase todos os arquivos. A primeira execução Codex D1 nessas cópias teve resultado 0.1 válido, 7/7 testes e revisão sem achados bloqueantes, mas **não integra a comparação formal**. Os moldes acima usam export sem conversão e auditoria de bytes. A prova PGlite de S1 mostrou que sua migração sintética reabre acesso após revogação (uma loja e RPC permitida), enquanto as migrações originais retornam zero lojas e SQLSTATE `42501`; esse é o defeito esperado, não um resultado de worker.

## D1 — braço Codex corrigido

O envelope `H04-D1-CODEX-02@1` passou no validador. A primeira tentativa do worker terminou por limite de créditos após modificar somente `packages/domain/tenancy.ts` e `tests/tenancy.test.ts`, sem relatório. Após a retomada, o worker concluiu a correção e o [resultado 0.1](H04_D1_CODEX_RESULTADO_2026-09-29.json), SHA-256 `B5271F4E7B5BB5A08C40557913E629FC2FC897DD0299EB5D3E43E2CB4721948B`, passou em `node scripts/harness/validate.mjs result`. A interrupção permanece no histórico.

O novo teste distinguiu o defeito. Na cópia final, Vitest passou **7/7**, `npx tsc --noEmit` saiu com código 0 e `git diff --check` saiu com código 0. A revisão independente `H04-D1-CODEX-02-REVIEW-INDEP-20260929` recebeu o envelope e o diff sem ler a conclusão do autor; conferiu apenas os dois caminhos permitidos, a função completa e o callsite, repetiu os três checks e concluiu `no_blocking_findings`. Não executou RLS hospedado nem a suíte inteira, fora do escopo dessa função pura.

O JSON registra 69 segundos para a retomada, enquanto o relato final do worker estimou cerca de 85 segundos até a validação. O tempo total da tentativa interrompida e da retomada **não é conhecido**; nenhum desses números será usado para comparar custo ou rapidez com DSH. Modelo efetivo, tokens e custo não foram expostos. O braço D1 ainda não tem resultado DSH.

## U1 — braço Codex em revisão dinâmica

O envelope `H04-U1-CODEX-01@1` foi executado no clone corrigido. O worker modificou somente `packages/ui/shell.tsx` e `tests/e2e/foundation.spec.ts`: vinculou `aria-expanded` ao estado real do menu e acrescentou cenário a 360 px para abertura, Escape, navegação por teclado, fechamento e overflow. O [resultado 0.1](H04_U1_CODEX_RESULTADO_2026-09-29.json), SHA-256 `2D817CB68666D2B5E654DDEF98F573F41D0902C3A3B0B3972E80025A82F515DE`, passou na validação estrutural e de Git (`node scripts/harness/validate.mjs result` a partir do clone). O status `ready_for_review` no envelope é a declaração do worker, não aceite do orquestrador.

A primeira suíte Playwright do worker teve **4 aprovações e 2 falhas**: o novo teste usava um localizador por papel ARIA que não encontrava o menu fechado, e um teste anterior esperava texto visível `404` em `/demo/nonexistent`. Após corrigir o localizador, o worker observou o novo cenário como `ok`, mas o encerramento dos servidores ficou preso e não houve código de saída zero. Uma repetição independente do cenário focado também não terminou e foi interrompida, sem resultado de teste utilizável. TypeScript e `git diff --check` saíram com código 0. Na cópia U1 **intacta**, uma requisição HTTP independente a `/demo/nonexistent` retornou 404, porém o HTML não continha `>404<`; a falha do teste antigo não foi introduzida pelo patch do menu. A tentativa de executar aquele teste na cópia intacta ficou presa e foi interrompida, portanto não há comparação Playwright concluída para ele.

A revisão cega `H04-U1-CODEX-01-REVIEW-INDEP-20260929` conferiu contrato, diff, hashes e invariantes sem ler a conclusão do worker. Encontrou somente os dois arquivos autorizados, confirmou estaticamente que o teste distingue o `aria-expanded=false` sintético e não encontrou achados bloqueantes no código. Repetiu TypeScript e diff com código 0. Sua tentativa Playwright não iniciou testes porque a porta 54329 estava ocupada pela comparação independente em andamento; não a contou como PASS. **U1-V1 permanece FAIL/inconclusivo para aceite** e U1-V4 passou apenas como revisão estática. Não comparar qualidade, tempo ou custo U1 com DSH antes de obter execução E2E confiável e revisão do resultado completo.

## Transporte DSH e próximos gates

O `config.toml` pessoal contém a raiz real e os caminhos **exatos** dos três clones DSH corrigidos; a comparação com o backup confirmou que só a linha da allowlist mudou. Porém `dsh_health` desta tarefa ainda mostra apenas a raiz real: o processo MCP mantém a configuração anterior. **Nenhum worker DSH foi enviado a esses clones.** Recarregar o servidor MCP DSH no Codex e confirmar os três caminhos em `dsh_health` antes do primeiro despacho. Não usar a raiz real como `cwd` para contornar o limite.

As seis cópias têm dependências do lockfile instaladas e os seis envelopes passaram no validador local. A preparação inicial de npm no sandbox falhou por `EACCES` de rede; a instalação autorizada e as instalações offline subsequentes passaram. O perfil DSH declara `sandbox: workspace-write`; a allowlist da ponte controla o `cwd`, mas não prova isolamento de leitura do processo. Registrar essa limitação em cada avaliação, conferir o diff real e manter um escritor por cópia. S1 deve carregar explicitamente a migração sintética antes da correção incremental; a suíte SQL original sozinha não valida o caso.

Após a recarga, executar D1 DSH; depois S1 na ordem DSH → Codex e U1 na ordem Codex → DSH. Antes de aceitar U1 Codex, resolver a execução Playwright e registrar claramente o teste 404 preexistente. Cada braço exige resultado 0.1, revisão independente e aceitação dos invariantes antes de comparar tempo ou custo. Uma execução por caso ainda será amostra pequena e não demonstrará estabilidade estatística.
