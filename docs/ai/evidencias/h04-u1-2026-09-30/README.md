# H-04 U1 — evidência externa de 30/09/2026 UTC

Base dos dois clones: `32416419132f4aa59b93a8ae95839e097af25064`. Candidato DSH: `shell.tsx` SHA-256 `e0bf7741290fa754d12e61c5069deb56f2775beacab6e91f9ef6e1195b177824`; `foundation.spec.ts` SHA-256 `743fd82d582dbb98a921a4c6264fc0e641ff9d775ab079200e38ce6085b71165`. O braço Codex conserva seu próprio patch já identificado no resultado histórico. Estes testes não alteraram a aplicação principal.

O executor [run-u1-external.mjs](run-u1-external.mjs) e a [configuração Playwright](playwright-u1-external.config.mjs) são cópias do executor temporário final. Seus caminhos absolutos apontam para o clone descartável desta execução; uma reprodução em outra pasta exige atualizar a raiz e registrar essa mudança. Auth e Next são iniciados por ele apenas se as portas 54329 e 3001 estiverem livres. O wrapper registra os PIDs que criou, encerra somente esses PIDs e confirma as portas livres. `taskkill` recebeu acesso negado; `child.kill()` foi o fallback efetivo. Nenhum PID anterior do DSH foi encerrado.

| Comando no clone | Resultado canônico | Logs principais |
| --- | --- | --- |
| `node ../run-u1-external.mjs dsh focused` | 2/2; Playwright 0; wrapper 0; portas livres | `u1-dsh-focused-{playwright,wrapper-v3}.{stdout,stderr}.log` |
| `node ../run-u1-external.mjs dsh full` | 6/6; Playwright 0; wrapper 0; portas livres | `u1-dsh-full-{playwright,wrapper-v3,next}.{stdout,stderr}.log` |
| `node ../run-u1-external.mjs codex full` | 6/6; Playwright 0; wrapper 0; portas livres | `u1-codex-full-{playwright,wrapper-v3}.{stdout,stderr}.log` |
| `npx tsc --noEmit` e `git diff --check` no DSH | códigos 0 | `u1-dsh-{tsc,diff}.{stdout,stderr}.log` |

Os demais logs sem sufixo `stdout`/`stderr` e `wrapper-v2` mostram as tentativas anteriores com captura incompleta. A primeira tentativa focada teve Playwright 0 e wrapper 1; não é evidência de PASS do executor. A reexecução canônica ocorreu porque o timeout e o cleanup foram corrigidos e depois porque §7 exigiu fluxos separados. Cada comando foi executado em série para não disputar as portas. A saída de Next DSH registra 307 das rotas protegidas para `/login` e 404 de `/demo/nonexistent`.

O envelope [revisão 1](task-dsh-r1.json) foi preservado e a [revisão 2](task-dsh-r2.json) atribui gates dinâmicos ao orquestrador, mantém `U1-V1` e adiciona `U1-V5`/`U1-V6`. O [resultado 0.1](../../H04_U1_DSH_RESULTADO_ORQUESTRADOR_2026-09-30.json) foi validado contra a revisão 2 no clone DSH; ele não foi emitido pelo worker. `U1-V1` original permanece FAIL no histórico Codex e `not_run` no DSH. A revisão 2 aceita `U1-V5` completo como gate funcional substitutivo apenas no experimento H-04; o runner original segue como reparo de infraestrutura. Os hashes de todos os arquivos desta pasta estão em [SHA256SUMS.txt](SHA256SUMS.txt).
